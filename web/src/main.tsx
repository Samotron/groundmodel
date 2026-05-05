import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">groundmodel v0.1</p>
        <h1>YAML-first ground models for validation, conversion, and review.</h1>
        <p className="lede">
          The Rust core now owns the schema, semantic validation, AGSi conversion,
          and thin wrapper surfaces for CLI, Python, and web integration.
        </p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
