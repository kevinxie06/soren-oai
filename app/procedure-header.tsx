import Link from "next/link";
import "./procedure-header.css";

export default function ProcedureHeader({
  current,
}: {
  current: "heart" | "stitch";
}) {
  return (
    <header className="procedure-header">
      <Link href="/" className="procedure-brand" aria-label="Soren workspace">
        soren
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/">Workspace</Link>
        <Link
          href="/showcase"
          aria-current={current === "heart" ? "page" : undefined}
        >
          Heart extraction
        </Link>
        <Link
          href="/suturing"
          aria-current={current === "stitch" ? "page" : undefined}
        >
          Suturing
        </Link>
      </nav>
    </header>
  );
}
