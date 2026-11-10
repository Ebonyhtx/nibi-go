// RN 全局 WebSocket → relay-client SocketLike 适配器。
// RN WebSocket：文本帧 e.data 为 string；addEventListener 可用；readyState 数值一致；
// 无法中止 CONNECTING 中的握手——terminate() 映射为 close()（transport 的 CONNECTING 分支
// 在 RN 上退化为尽力关闭，语义差异已与 A1-1 注释对应）。
import type { SocketFactory } from "@nibi-go/relay-client";

export function createRnSocketFactory(): SocketFactory {
  return (url) => {
    const socket = new WebSocket(url);
    return {
      send: (data) => socket.send(data),
      close: (code) => socket.close(code, undefined),
      terminate: () => {
        try {
          socket.close();
        } catch {
          // 关闭未建立的连接可能抛错；transport 下一轮重连会重建
        }
      },
      get readyState() {
        return socket.readyState;
      },
      onOpen: (listener) => socket.addEventListener("open", listener),
      onMessage: (listener) =>
        socket.addEventListener("message", (event) => listener(String(event.data))),
      onError: (listener) => socket.addEventListener("error", () => listener()),
      onClose: (listener) => socket.addEventListener("close", () => listener()),
    };
  };
}
