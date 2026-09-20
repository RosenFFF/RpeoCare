"use client";
import { useEffect, useState } from "react";

export function useDemoCounts() {
  const [counts, setCounts] = useState({ issues: 3, prs: 2, docs: 3, reviewedIssues: [] as number[], reviewedPRs: [40] as number[], acceptedDocs: [] as string[] });
  useEffect(() => {
    const read = () => {
      try {
        const issues = JSON.parse(sessionStorage.getItem("openbridge.issues.v1") || "null");
        const prs = JSON.parse(sessionStorage.getItem("openbridge.prs.v1") || "null");
        const docs = JSON.parse(sessionStorage.getItem("openbridge.improvements.v1") || "null");
        setCounts({
          issues: 3 - [42,39,37].filter(id => issues?.confirmed?.[id]).length,
          prs: prs?.confirmed ? 3 - [45,43,40].filter(id => prs.confirmed[id]).length : 2,
          docs: 3 - (Array.isArray(docs) ? docs.filter(id => ["contributing","bug-template","pr-template"].includes(id)).length : 0),
          reviewedIssues: [42,39,37].filter(id => issues?.confirmed?.[id]),
          reviewedPRs: prs?.confirmed ? [45,43,40].filter(id => prs.confirmed[id]) : [40],
          acceptedDocs: Array.isArray(docs) ? docs : [],
        });
      } catch { /* Demo remains usable if browser storage is unavailable. */ }
    };
    read(); window.addEventListener("openbridge-demo-change", read);
    return () => window.removeEventListener("openbridge-demo-change", read);
  }, []);
  return counts;
}
