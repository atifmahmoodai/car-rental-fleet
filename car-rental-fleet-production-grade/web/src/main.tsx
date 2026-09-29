import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api, errorText, setUnauthorizedHandler } from "./api/client";
import { App } from "./App";
import { applyCatalog } from "./config";
import type { Catalog } from "../../shared/schemas";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && !(e as { status?: number }).status },
  },
});
setUnauthorizedHandler(() => queryClient.setQueryData(["me"], null));
const root = createRoot(document.getElementById("root")!);

async function start() {
  try {
    applyCatalog(await api<Catalog>("/public/catalog"));
  } catch (e) {
    root.render(
      <div className="container section">
        <div className="card empty">
          <h1>We'll be right back</h1>
          <p className="muted">{errorText(e)}</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
void start();
