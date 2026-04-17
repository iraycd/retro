import { useRouter } from "./routing";
import { Landing } from "./pages/Landing";
import { BoardPage } from "./pages/Board";

export default function App() {
  const { path, params } = useRouter();

  if (path.startsWith("/b/") && params.code) {
    return <BoardPage code={params.code} />;
  }

  return <Landing />;
}
