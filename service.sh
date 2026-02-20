#!/bin/bash

# ============================================================
# Configuration
# ============================================================
APP_NAME="icu_anesthesia_project"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_EXEC="python3"
MAIN_SCRIPT="app.py"
PID_FILE="$APP_DIR/app.pid"
LOG_FILE="$APP_DIR/app.log"
PORT=5000
STOP_TIMEOUT=10
START_WAIT=3

# Use virtual environment if it exists
if [ -d "$APP_DIR/.venv" ]; then
    PYTHON_EXEC="$APP_DIR/.venv/bin/python3"
fi

cd "$APP_DIR"

# ============================================================
# 颜色输出
# ============================================================
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================
# 函数
# ============================================================
usage() {
    echo "Usage: $0 {start|stop|restart|status|log}"
    exit 1
}

# 获取占用端口的所有 PID
get_port_pids() {
    if command -v lsof &>/dev/null; then
        lsof -t -i:$PORT 2>/dev/null
    elif command -v ss &>/dev/null; then
        ss -lntp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | sort -u
    elif command -v fuser &>/dev/null; then
        fuser $PORT/tcp 2>/dev/null
    else
        log_error "未找到 lsof/ss/fuser，无法检测端口占用"
        return 1
    fi
}

# 检测并杀掉占用指定端口的进程
kill_port() {
    PIDS=$(get_port_pids)
    if [ -n "$PIDS" ]; then
        log_warn "端口 $PORT 被以下进程占用: $(echo $PIDS | tr '\n' ' ')"
        # 先温柔 kill，等 3 秒
        echo "$PIDS" | xargs kill 2>/dev/null
        sleep 3
        # 检查是否还活着，强制 kill
        REMAINING=$(get_port_pids)
        if [ -n "$REMAINING" ]; then
            log_warn "进程仍存活，强制 kill..."
            echo "$REMAINING" | xargs kill -9 2>/dev/null
            sleep 1
        fi
        log_info "端口 $PORT 已清理"
    fi
}

# 检查 PID 文件对应的进程是否还在
is_running() {
    [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null
}

start() {
    if is_running; then
        log_warn "$APP_NAME 已在运行 (PID: $(cat $PID_FILE))，无需重复启动"
        return 0
    fi

    # 清理可能残留的 PID 文件
    rm -f "$PID_FILE"

    # 启动前自动清理端口占用
    kill_port

    log_info "正在启动 $APP_NAME..."
    nohup "$PYTHON_EXEC" "$MAIN_SCRIPT" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"

    sleep $START_WAIT
    if is_running; then
        log_info "$APP_NAME 启动成功 (PID: $(cat $PID_FILE)，端口: $PORT)"
    else
        log_error "$APP_NAME 启动失败，请查看日志："
        echo "----------------------------------------"
        tail -20 "$LOG_FILE"
        echo "----------------------------------------"
        rm -f "$PID_FILE"
        return 1
    fi
}

stop() {
    if ! is_running; then
        log_warn "$APP_NAME 未在运行"
        rm -f "$PID_FILE"
        # 仍然清理端口，防止残留子进程（如 gunicorn worker）
        kill_port
        return 0
    fi

    PID=$(cat "$PID_FILE")
    log_info "正在停止 $APP_NAME (PID: $PID)..."
    kill "$PID"

    for i in $(seq 1 $STOP_TIMEOUT); do
        if ! kill -0 "$PID" 2>/dev/null; then
            log_info "$APP_NAME 已停止"
            rm -f "$PID_FILE"
            # 清理可能残留的 worker 进程
            kill_port
            return 0
        fi
        sleep 1
    done

    log_warn "等待超时，强制停止..."
    kill -9 "$PID" 2>/dev/null
    rm -f "$PID_FILE"
    kill_port
    log_info "$APP_NAME 已强制停止"
}

status() {
    if is_running; then
        log_info "$APP_NAME 正在运行 (PID: $(cat $PID_FILE))"
    else
        log_warn "$APP_NAME 未运行"
    fi

    # 同时显示端口占用情况
    PORT_PIDS=$(get_port_pids)
    if [ -n "$PORT_PIDS" ]; then
        log_info "端口 $PORT 被以下进程占用: $(echo $PORT_PIDS | tr '\n' ' ')"
    else
        log_warn "端口 $PORT 无进程占用"
    fi
}

show_log() {
    if [ -f "$LOG_FILE" ]; then
        tail -50 "$LOG_FILE"
    else
        log_warn "日志文件不存在: $LOG_FILE"
    fi
}

# ============================================================
# 入口
# ============================================================
case "$1" in
    start)   start   ;;
    stop)    stop    ;;
    restart) stop; start ;;
    status)  status  ;;
    log)     show_log ;;
    *)       usage   ;;
esac