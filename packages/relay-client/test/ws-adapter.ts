// Node 测试用 SocketFactory（ws 实现 SocketLike）。RN 生产适配器由 app/ 提供。
import { WebSocket } from "ws";

import type { SocketFactory } from "../src/types";

export function createNodeSocketFactory(): SocketFactory {
  return (url) => {
    const socket = new WebSocket(url);
    return {
      send: (data) => socket.send(data),
      close: (code) => socket.close(code),
      terminate: () => socket.terminate(),
      get readyState() {
        return socket.readyState;
      },
      onOpen: (listener) => socket.on("open", listener),
      onMessage: (listener) =>
        socket.on("message", (data, isBinary) => {
          if (!isBinary) listener(data.toString());
        }),
      onError: (listener) => socket.on("error", () => listener()),
      onClose: (listener) => socket.on("close", listener),
    };
  };
}
