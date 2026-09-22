import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Editor } from "./routes/Editor.js";
import { PromoWorkspace } from "./components/PromoWorkspace.js";

const router = createBrowserRouter([
  { path: "/", element: <Editor /> },
  { path: "/promo", element: <PromoWorkspace /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
