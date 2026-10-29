import React from "react";
import { Hourglass } from "lucide-react";
import { EmptyState } from "../components/ui.jsx";

// Placeholder for pages whose milestone isn't built yet.
export function ComingSoon({ title, text }) {
  return <EmptyState icon={Hourglass} title={title} text={text} />;
}
