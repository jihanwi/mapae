// W-T63: a sentence whose figures (digit runs with , and .) are set in the .num face, the words
// left in the text face; for labels such as "실명 지갑 12개 응모" where the number should line up.
export function NumText({text, className = ""}: {text: string; className?: string}) {
    const parts = text.split(/(\d[\d,.]*)/);
    return (
        <span className={className}>
            {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="num">{p}</span> : p))}
        </span>
    );
}
