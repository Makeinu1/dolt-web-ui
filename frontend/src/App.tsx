import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useDraftStore } from "./store/draft";
import "./App.css";

function HomePage() {
  return (
    <div style={{ padding: "2rem" }}>
      <h1>Dolt Web UI</h1>
      <p>PSX Data Change Management Workbench</p>
      <p style={{ color: "#888" }}>
        Select a target, database, and branch to get started.
      </p>
    </div>
  );
}

function App() {
  const loadDraft = useDraftStore((s) => s.loadDraft);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
