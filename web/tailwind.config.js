/** design-tokens.md 1:1 이식 — "조선 마패 메달리온" (다크 온리) */
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        colors: {
            transparent: "transparent",
            ink: {950: "#1A1510", 900: "#221C15", 800: "#2A231A", 700: "#3A3126"},
            brass: {400: "#C39A3B", 500: "#D4AC4E", 600: "#8A6D2F"},
            hanji: {100: "#F2EAD9", 400: "#A89880"},
            success: "#7A9B6D",
            // Decision 52: #C97A68 (was #B0604F) for 4.5:1 text contrast on ink-950/900/800.
            error: "#C97A68",
            placeholder: "#6B5F4E",
            // Candle chart only (CandleChart.tsx: candles and volume bars). Not for any other UI.
            up: "#3FB68B",
            down: "#E5484D",
        },
        fontFamily: {
            sans: ['"Pretendard Variable"', "Pretendard", "sans-serif"],
            serif: ['"Noto Serif KR"', "serif"],
        },
        extend: {
            maxWidth: {page: "1240px"},
            borderRadius: {card: "16px", input: "10px", stat: "12px"},
        },
    },
    plugins: [],
};
