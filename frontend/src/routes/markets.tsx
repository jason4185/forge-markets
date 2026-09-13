import { createFileRoute } from "@tanstack/react-router";
import { MarketsPage } from "./index";

export const Route = createFileRoute("/markets")({
  component: MarketsPage,
});
