import React from "react";
import { createRoot } from "react-dom/client";
import Ezelen from "./Ezelen.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Ezelen />
  </React.StrictMode>
);

// PWA: vite-plugin-pwa (autoUpdate) registers the service worker. When a NEW
// worker takes control (a real update), reload once so an installed app never
// stays stuck on an old build. Skip the very first install (no prior controller).
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    if (hadController) window.location.reload();
  });
}
