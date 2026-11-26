interface HighlightTextProps {
  text: string;
  query: string;
}

export function HighlightText({ text, query }: HighlightTextProps) {
  const q = query.trim();
  if (!q) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = q.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);

  return (
    <>
      {before}
      <mark className="bg-amber-200/75 dark:bg-amber-400/30 text-slate-900 dark:text-amber-100 rounded-xs px-0.5">{match}</mark>
      {after}
    </>
  );
}
