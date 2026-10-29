package com.yuanbao.ddz;

import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;

import java.util.List;

/**
 * 桌面角标（App 图标红点数字）。
 *
 * Android 原生没有统一角标 API，各 launcher 各搞一套：
 * 华为 / vivo / 三星 / 通用（Nova、Apex 等）等各有不同的广播或 ContentProvider。
 * 这里不引入任何第三方库（避免编译期依赖风险），只实现主流方案，
 * 全部失败也不抛异常 —— 最多是角标不显示，不影响通知本身。
 */
public final class BadgeUtil {

    private static final String MANUFACTURER_HUAWEI = "Huawei";
    private static final String MANUFACTURER_XIAOMI = "Xiaomi";
    private static final String MANUFACTURER_VIVO = "vivo";
    private static final String MANUFACTURER_OPPO = "OPPO";
    private static final String MANUFACTURER_SAMSUNG = "samsung";

    private BadgeUtil() { }

    public static void setBadge(Context ctx, int count) {
        if (ctx == null || count < 0) return;
        try {
            String man = Build.MANUFACTURER;
            if (man == null) man = "";
            boolean done = false;
            if (man.equalsIgnoreCase(MANUFACTURER_HUAWEI)) done = setHuawei(ctx, count);
            else if (man.equalsIgnoreCase(MANUFACTURER_XIAOMI)) done = setXiaomi(ctx, count);
            else if (man.equalsIgnoreCase(MANUFACTURER_VIVO)) done = setVivo(ctx, count);
            else if (man.equalsIgnoreCase(MANUFACTURER_OPPO)) done = setOppo(ctx, count);
            else if (man.equalsIgnoreCase(MANUFACTURER_SAMSUNG)) done = setSamsung(ctx, count);
            // 上面不识别的机型，再试通用方案（Nova / Apex / 一批国产 launcher）
            if (!done) setGeneric(ctx, count);
        } catch (Throwable ignored) { }
    }

    /** 华为：广播 */
    private static boolean setHuawei(Context ctx, int count) {
        try {
            String pkg = ctx.getPackageName();
            String launcher = findLauncher(ctx);
            if (TextUtils.isEmpty(launcher)) return false;
            Intent i = new Intent("android.intent.action.BADGE_COUNT_UPDATE");
            i.putExtra("badge_count", count);
            i.putExtra("badge_count_package", pkg);
            i.putExtra("badge_count_class_name", launcher);
            ctx.sendBroadcast(i);
            return true;
        } catch (Throwable e) { return false; }
    }

    /** 小米：走通知的 extra（需要先有一条通知），这里同时用反射备用方案 */
    private static boolean setXiaomi(Context ctx, int count) {
        try {
            // 小米读的是通知上的 number 字段；DDZPushService 发通知时会带上，
            // 这里再补一次反射方案（部分 MIUI 版本需要）
            Intent i = new Intent("android.intent.action.APPLICATION_MESSAGE_UPDATE");
            i.putExtra("android.intent.extra.update_application_component_name",
                    ctx.getPackageName() + "/" + findLauncher(ctx));
            i.putExtra("android.intent.extra.update_application_message_text", String.valueOf(count));
            ctx.sendBroadcast(i);
            return true;
        } catch (Throwable e) { return false; }
    }

    /** vivo：广播 */
    private static boolean setVivo(Context ctx, int count) {
        try {
            String launcher = findLauncher(ctx);
            if (TextUtils.isEmpty(launcher)) return false;
            Intent i = new Intent("launcher.action.CHANGE_APPLICATION_NOTIFICATION_NUM");
            i.putExtra("packageName", ctx.getPackageName());
            i.putExtra("className", launcher);
            i.putExtra("notificationNum", count);
            ctx.sendBroadcast(i);
            return true;
        } catch (Throwable e) { return false; }
    }

    /** OPPO：需要系统签名权限，多数机型不可用 → 返回 false 走通用方案 */
    private static boolean setOppo(Context ctx, int count) {
        try {
            Intent i = new Intent("com.oppo.unsettledevent");
            i.putExtra("packageName", ctx.getPackageName());
            i.putExtra("number", count);
            i.putExtra("upgradeNumber", count);
            PackageManager pm = ctx.getPackageManager();
            List<ResolveInfo> rs = pm.queryBroadcastReceivers(i, 0);
            if (rs != null && !rs.isEmpty()) {
                ctx.sendBroadcast(i);
                return true;
            }
            return false;
        } catch (Throwable e) { return false; }
    }

    /** 三星：ContentProvider */
    private static boolean setSamsung(Context ctx, int count) {
        try {
            String launcher = findLauncher(ctx);
            if (TextUtils.isEmpty(launcher)) return false;
            Uri uri = Uri.parse("content://com.sec.badge/apps");
            ContentResolver cr = ctx.getContentResolver();
            Cursor c = null;
            boolean exists = false;
            try {
                c = cr.query(uri, new String[]{"_id"}, "package=?", new String[]{ctx.getPackageName()}, null);
                exists = (c != null && c.getCount() > 0);
            } catch (Throwable ignored) { } finally {
                if (c != null) { try { c.close(); } catch (Throwable ignored) { } }
            }
            if (!exists) {
                ContentValues cv = new ContentValues();
                cv.put("package", ctx.getPackageName());
                cv.put("class", launcher);
                cv.put("badgecount", count);
                try { cr.insert(uri, cv); return true; } catch (Throwable e) { return false; }
            }
            ContentValues cv = new ContentValues();
            cv.put("badgecount", count);
            try {
                cr.update(uri, cv, "package=?", new String[]{ctx.getPackageName()}, null);
                return true;
            } catch (Throwable e) { return false; }
        } catch (Throwable e) { return false; }
    }

    /** 通用：Nova / Apex / SOLID / 一批国产 launcher 的 ContentProvider */
    private static boolean setGeneric(Context ctx, int count) {
        String[] authorities = {
                "com.teslacoilsw.notifier",      // Nova
                "com.teslacoilsw.widgets",
                "com.anddoes.launcher",          // Apex(?)
                "com.sec.android.app.launcher"   // 部分三星
        };
        for (String a : authorities) {
            try {
                Uri uri = Uri.parse("content://" + a + "/unread_count");
                ContentValues cv = new ContentValues();
                cv.put("package", ctx.getPackageName());
                cv.put("class", findLauncher(ctx));
                cv.put("count", count);
                ctx.getContentResolver().insert(uri, cv);
                return true;
            } catch (Throwable ignored) { }
        }
        return false;
    }

    /** 找主入口 Activity 的完整类名 */
    private static String findLauncher(Context ctx) {
        try {
            PackageManager pm = ctx.getPackageManager();
            Intent it = new Intent(Intent.ACTION_MAIN);
            it.addCategory(Intent.CATEGORY_LAUNCHER);
            it.setPackage(ctx.getPackageName());
            List<ResolveInfo> rs = pm.queryIntentActivities(it, 0);
            if (rs != null && !rs.isEmpty()) {
                ResolveInfo r = rs.get(0);
                if (r.activityInfo != null) return r.activityInfo.name;
            }
            ComponentName cn = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName()).getComponent();
            return cn == null ? null : cn.getClassName();
        } catch (Throwable e) {
            return null;
        }
    }
}
