import { useWebSocket } from "@/hooks/useWebSocket";
import { Dashboard } from "@/components/Dashboard";

export default function App() {
  useWebSocket();
  return <Dashboard />;
}
