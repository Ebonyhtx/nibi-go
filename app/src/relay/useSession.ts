import { useSyncExternalStore } from "react";

import { RelaySession, type SessionSnapshot } from "./session";

/** App 级单例：Fast Refresh 会重建模块但连接在 transport 内自持，重挂载无害。 */
const session = new RelaySession();

export function useSession(): { session: RelaySession; snapshot: SessionSnapshot } {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { session, snapshot };
}
