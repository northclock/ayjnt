import { createRoot } from "react-dom/client";
import { useAgent } from "@ayjnt/sector";

function App() {
  const agent = useAgent();
  return <div>Hello, world!</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
