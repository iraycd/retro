import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { Router } from "./routing";
import { ConfirmProvider } from "./components/ConfirmDialog";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(
  <StrictMode>
    <Router>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </Router>
  </StrictMode>
);
