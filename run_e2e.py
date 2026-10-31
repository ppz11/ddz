import subprocess, time, socket, os

os.system("pgrep -f 'serv[e]r/server.js' | xargs -r kill 2>/dev/null")
time.sleep(1)
srv = subprocess.Popen(["node", "server/server.js"], cwd="/data/workspace/ddz",
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait(port, t=15):
    t0 = time.time()
    while time.time() - t0 < t:
        try:
            s = socket.create_connection(("127.0.0.1", port), 0.5)
            s.close()
            return True
        except Exception:
            time.sleep(0.3)
    return False


ok = wait(8080)
print("服务端:", "✔" if ok else "✘")
if ok:
    try:
        r = subprocess.run(["node", "t_e2e.js"], cwd="/data/workspace/ddz",
                           capture_output=True, text=True, timeout=60)
        print(r.stdout)
        if r.stderr.strip():
            print("STDERR:", r.stderr[-400:])
    except subprocess.TimeoutExpired:
        print("✘ 客户端脚本超时")
srv.kill()
