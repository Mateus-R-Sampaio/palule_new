// Gera os mockups (SVG brancos, tingíveis por CSS) e as 27 estampas de exemplo.
// Uso: node tools/generate-assets.mjs
// Os arquivos podem ser substituídos por PNGs reais pelo painel admin.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (rel, content) => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content.trim() + "\n");
};

/* ------------------------------------------------------------------ */
/* Mockups (1000×1000). Produto em branco/cinza: o site aplica a cor  */
/* escolhida por baixo com mix-blend-mode: multiply.                  */
/* ------------------------------------------------------------------ */
const mock = (defs, body) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>${defs}</defs>
  ${body}
</svg>`;

const bodyGradient = (id) => `
  <linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="#d9d9d9"/>
    <stop offset=".18" stop-color="#f4f4f4"/>
    <stop offset=".42" stop-color="#ffffff"/>
    <stop offset=".72" stop-color="#f3f3f3"/>
    <stop offset="1" stop-color="#cfcfcf"/>
  </linearGradient>`;

out(
  "img/Mockups/copo_termico/copo_termico.svg",
  mock(
    bodyGradient("cup") +
      `<linearGradient id="lid" x1="0" x2="1"><stop offset="0" stop-color="#bdbdbd"/><stop offset=".45" stop-color="#e6e6e6"/><stop offset="1" stop-color="#b5b5b5"/></linearGradient>`,
    `
  <ellipse cx="500" cy="955" rx="230" ry="18" fill="#000" opacity=".12"/>
  <path d="M250 165 L750 165 L702 925 Q700 950 675 950 L325 950 Q300 950 298 925 Z" fill="url(#cup)" stroke="#c4c4c4" stroke-width="4"/>
  <path d="M300 200 L330 900" stroke="#fff" stroke-width="22" stroke-linecap="round" opacity=".8"/>
  <path d="M672 200 L648 900" stroke="#bdbdbd" stroke-width="10" stroke-linecap="round" opacity=".45"/>
  <rect x="232" y="128" width="536" height="52" rx="16" fill="url(#lid)" stroke="#a9a9a9" stroke-width="4"/>
  <rect x="262" y="92" width="476" height="46" rx="20" fill="url(#lid)" stroke="#a9a9a9" stroke-width="4"/>
  <rect x="560" y="100" width="110" height="26" rx="10" fill="#9e9e9e"/>
  <path d="M300 905 L700 905" stroke="#c9c9c9" stroke-width="6"/>`
  )
);

const shirtPath =
  "M365 118 Q500 190 635 118 L805 178 L960 335 L850 455 L762 392 L762 925 Q762 952 735 952 L265 952 Q238 952 238 925 L238 392 L150 455 L40 335 L195 178 Z";

out(
  "img/Mockups/camiseta/camiseta_frente.svg",
  mock(
    bodyGradient("shirt"),
    `
  <path d="${shirtPath}" fill="url(#shirt)" stroke="#c6c6c6" stroke-width="5" stroke-linejoin="round"/>
  <path d="M365 118 Q500 235 635 118" fill="none" stroke="#bfbfbf" stroke-width="14" stroke-linecap="round"/>
  <path d="M365 118 Q500 205 635 118" fill="#e9e9e9" stroke="#cfcfcf" stroke-width="4"/>
  <path d="M238 392 L238 300" stroke="#d2d2d2" stroke-width="5" opacity=".7"/>
  <path d="M762 392 L762 300" stroke="#d2d2d2" stroke-width="5" opacity=".7"/>
  <path d="M300 780 Q330 860 300 930" stroke="#dcdcdc" stroke-width="8" fill="none" opacity=".8"/>
  <path d="M700 760 Q670 850 705 930" stroke="#dcdcdc" stroke-width="8" fill="none" opacity=".8"/>
  <path d="M245 915 L755 915" stroke="#d6d6d6" stroke-width="5"/>`
  )
);

out(
  "img/Mockups/camiseta/camiseta_costas.svg",
  mock(
    bodyGradient("shirtb"),
    `
  <path d="${shirtPath}" fill="url(#shirtb)" stroke="#c6c6c6" stroke-width="5" stroke-linejoin="round"/>
  <path d="M365 118 Q500 160 635 118" fill="none" stroke="#c4c4c4" stroke-width="12" stroke-linecap="round"/>
  <rect x="478" y="140" width="44" height="26" rx="4" fill="#d8d8d8"/>
  <path d="M500 175 L500 930" stroke="#e1e1e1" stroke-width="4" opacity=".6"/>
  <path d="M238 392 L238 300" stroke="#d2d2d2" stroke-width="5" opacity=".7"/>
  <path d="M762 392 L762 300" stroke="#d2d2d2" stroke-width="5" opacity=".7"/>
  <path d="M245 915 L755 915" stroke="#d6d6d6" stroke-width="5"/>`
  )
);

out(
  "img/Mockups/ecobag/ecobag.svg",
  mock(
    bodyGradient("bag"),
    `
  <path d="M335 345 C335 70 665 70 665 345" fill="none" stroke="#c9c9c9" stroke-width="40" stroke-linecap="round"/>
  <path d="M335 345 C335 70 665 70 665 345" fill="none" stroke="#f1f1f1" stroke-width="26" stroke-linecap="round"/>
  <path d="M205 320 L795 320 L815 930 Q815 952 793 952 L207 952 Q185 952 185 930 Z" fill="url(#bag)" stroke="#c4c4c4" stroke-width="5" stroke-linejoin="round"/>
  <path d="M205 352 L795 352" stroke="#d5d5d5" stroke-width="6" stroke-dasharray="14 10"/>
  <rect x="318" y="320" width="34" height="70" fill="#e3e3e3"/>
  <rect x="648" y="320" width="34" height="70" fill="#e3e3e3"/>
  <path d="M250 900 Q500 915 750 900" stroke="#dadada" stroke-width="6" fill="none"/>`
  )
);

out(
  "img/Mockups/bone/bone.svg",
  mock(
    `<radialGradient id="crown" cx=".45" cy=".35" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".65" stop-color="#ededed"/><stop offset="1" stop-color="#cdcdcd"/></radialGradient>
     <linearGradient id="bill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#d6d6d6"/><stop offset="1" stop-color="#b9b9b9"/></linearGradient>`,
    `
  <ellipse cx="500" cy="805" rx="330" ry="30" fill="#000" opacity=".1"/>
  <path d="M215 610 C215 300 360 215 500 215 C640 215 785 300 785 610 Z" fill="url(#crown)" stroke="#c2c2c2" stroke-width="5"/>
  <path d="M500 220 C470 330 465 470 470 610" fill="none" stroke="#d0d0d0" stroke-width="5"/>
  <path d="M500 220 C530 330 535 470 530 610" fill="none" stroke="#d0d0d0" stroke-width="5"/>
  <path d="M500 220 C380 280 300 420 280 610" fill="none" stroke="#dadada" stroke-width="4"/>
  <path d="M500 220 C620 280 700 420 720 610" fill="none" stroke="#dadada" stroke-width="4"/>
  <circle cx="500" cy="222" r="20" fill="#d4d4d4" stroke="#bdbdbd" stroke-width="4"/>
  <path d="M175 610 Q500 545 825 610 Q875 705 770 770 Q500 705 230 770 Q125 705 175 610 Z" fill="url(#bill)" stroke="#a9a9a9" stroke-width="5"/>
  <path d="M215 640 Q500 590 785 640" fill="none" stroke="#c4c4c4" stroke-width="4" stroke-dasharray="10 8"/>`
  )
);

/* ------------------------------------------------------------------ */
/* Estampas de exemplo (600×600, fundo transparente)                  */
/* ------------------------------------------------------------------ */
const art = (body, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;

const starPoints = (cx, cy, r1, r2, n = 5, rot = -90) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? r2 : r1;
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

const hex = (cx, cy, r) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

const heart = "M300 520 C120 400 60 280 120 190 C180 100 280 120 300 205 C320 120 420 100 480 190 C540 280 480 400 300 520 Z";
const display = `font-family="Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif" font-weight="900"`;

const designs = {
  17: ["Natureza", "Sol radiante", art(`<g transform="translate(300 300)">${Array.from({ length: 16 }, (_, i) => `<path d="M0 -280 L24 -175 L-24 -175 Z" fill="#ffb627" transform="rotate(${i * 22.5})"/>`).join("")}<circle r="150" fill="#ff7a00"/><circle r="118" fill="#ffc43d"/><circle cx="-40" cy="-40" r="26" fill="#fff" opacity=".45"/></g>`)],
  18: ["Ícones", "Coração brilhante", art(`<path d="${heart}" fill="#ff4d6d" stroke="#c9184a" stroke-width="12" stroke-linejoin="round"/><ellipse cx="200" cy="230" rx="45" ry="28" fill="#fff" opacity=".45" transform="rotate(-35 200 230)"/><polygon points="${starPoints(470, 120, 45, 14, 4, 0)}" fill="#ffd23f"/><polygon points="${starPoints(120, 470, 30, 9, 4, 0)}" fill="#ffd23f"/>`)],
  19: ["Formas", "Estrela", art(`<polygon points="${starPoints(300, 315, 270, 115)}" fill="#ffd23f" stroke="#f08a24" stroke-width="16" stroke-linejoin="round"/><polygon points="${starPoints(300, 315, 140, 60)}" fill="#fff3b0" opacity=".7"/>`)],
  20: ["Natureza", "Montanhas", art(`<g clip-path="url(#c20)"><rect width="600" height="600" fill="#2b4c7e"/><circle cx="410" cy="210" r="60" fill="#ffd166"/><polygon points="40,520 220,230 400,520" fill="#9fc1ef"/><polygon points="220,520 400,180 600,520" fill="#e8f1ff"/><polygon points="355,265 400,180 445,265 420,250 400,275 380,250" fill="#fff"/><rect y="470" width="600" height="130" fill="#1b3358"/></g><circle cx="300" cy="300" r="250" fill="none" stroke="#1b3358" stroke-width="18"/>`, `<clipPath id="c20"><circle cx="300" cy="300" r="250"/></clipPath>`)],
  21: ["Ícones", "Ondas", art([0, 1, 2, 3, 4].map((i) => `<path d="M60 ${170 + i * 65} Q135 ${120 + i * 65} 210 ${170 + i * 65} T360 ${170 + i * 65} T510 ${170 + i * 65}" fill="none" stroke="${["#0077b6", "#0096c7", "#00b4d8", "#48cae4", "#90e0ef"][i]}" stroke-width="30" stroke-linecap="round"/>`).join(""))],
  22: ["Natureza", "Flor", art(`<g transform="translate(300 300)">${Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="-150" rx="75" ry="125" fill="${i % 2 ? "#ff8fab" : "#fb6f92"}" transform="rotate(${i * 45})"/>`).join("")}<circle r="80" fill="#ffd166" stroke="#f4a261" stroke-width="10"/></g>`)],
  23: ["Ícones", "Raio", art(`<polygon points="340,40 140,330 280,330 230,560 470,240 320,240 400,40" fill="#ffe14d" stroke="#171a25" stroke-width="16" stroke-linejoin="round"/>`)],
  24: ["Natureza", "Lua e estrelas", art(`<path d="M370 95 A215 215 0 1 0 370 505 A170 170 0 1 1 370 95 Z" fill="#f6e7a1" stroke="#d4a72c" stroke-width="10"/><polygon points="${starPoints(450, 190, 46, 18)}" fill="#ffd23f"/><polygon points="${starPoints(500, 360, 30, 12)}" fill="#ffd23f"/><polygon points="${starPoints(420, 470, 22, 9)}" fill="#ffd23f"/>`)],
  25: ["Frases", "Good Vibes", art(`<text x="300" y="275" text-anchor="middle" font-size="150" ${display} fill="#ff5a67" stroke="#171a25" stroke-width="6" paint-order="stroke">GOOD</text><text x="300" y="420" text-anchor="middle" font-size="150" ${display} fill="#ffb627" stroke="#171a25" stroke-width="6" paint-order="stroke">VIBES</text><path d="M110 470 Q205 430 300 470 T490 470" fill="none" stroke="#171a25" stroke-width="14" stroke-linecap="round"/>`)],
  26: ["Ícones", "Sorriso", art(`<circle cx="300" cy="300" r="250" fill="#ffd23f" stroke="#171a25" stroke-width="16"/><ellipse cx="215" cy="245" rx="30" ry="48" fill="#171a25"/><ellipse cx="385" cy="245" rx="30" ry="48" fill="#171a25"/><path d="M160 355 Q300 500 440 355" fill="none" stroke="#171a25" stroke-width="22" stroke-linecap="round"/>`)],
  27: ["Natureza", "Pôr do sol tropical", art(`<g clip-path="url(#c27)"><rect width="600" height="600" fill="url(#g27)"/>${[0, 1, 2, 3].map((i) => `<rect y="${390 + i * 40}" width="600" height="${10 + i * 4}" fill="#fff" opacity=".9"/>`).join("")}<path d="M330 560 Q340 400 310 250" fill="none" stroke="#2d1b3d" stroke-width="22"/><path d="M310 250 Q230 190 130 230 Q230 215 310 255 Q250 290 210 380 Q280 300 315 258 Q380 230 470 280 Q390 215 312 250 Q360 170 440 140 Q340 160 308 248" fill="#2d1b3d"/></g>`, `<clipPath id="c27"><circle cx="300" cy="300" r="260"/></clipPath><linearGradient id="g27" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff006e"/><stop offset=".5" stop-color="#fb5607"/><stop offset="1" stop-color="#ffbe0b"/></linearGradient>`)],
  28: ["Formas", "Triângulos", art(`<polygon points="300,60 540,480 60,480" fill="#3a86ff"/><polygon points="300,200 450,460 150,460" fill="#ff006e"/><polygon points="300,300 380,440 220,440" fill="#ffbe0b"/><polygon points="120,120 200,250 40,250" fill="#8338ec"/><polygon points="480,110 560,240 400,240" fill="#06d6a0"/>`)],
  29: ["Natureza", "Cacto", art(`<rect x="250" y="110" width="100" height="340" rx="50" fill="#2a9d8f"/><path d="M250 330 L190 330 Q150 330 150 290 L150 220" fill="none" stroke="#2a9d8f" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/><path d="M350 280 L410 280 Q450 280 450 240 L450 180" fill="none" stroke="#2a9d8f" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/><path d="M300 140 L300 430" stroke="#21867a" stroke-width="8"/><polygon points="200,440 400,440 370,560 230,560" fill="#e76f51"/><rect x="185" y="425" width="230" height="40" rx="10" fill="#f4a261"/><circle cx="300" cy="105" r="22" fill="#ff8fab"/>`)],
  30: ["Frases", "Coffee time", art(`<path d="M150 230 L420 230 L395 470 Q390 510 350 510 L220 510 Q180 510 175 470 Z" fill="#6f4e37"/><path d="M415 270 Q500 270 495 345 Q490 420 400 415" fill="none" stroke="#6f4e37" stroke-width="30"/><rect x="130" y="505" width="310" height="28" rx="14" fill="#3e2a1e"/>${[200, 285, 370].map((x) => `<path d="M${x} 200 Q${x - 25} 160 ${x} 125 Q${x + 25} 90 ${x} 55" fill="none" stroke="#b08968" stroke-width="14" stroke-linecap="round"/>`).join("")}<text x="285" y="395" text-anchor="middle" font-size="58" ${display} fill="#fdf0d5">COFFEE</text><text x="285" y="450" text-anchor="middle" font-size="40" ${display} fill="#fdf0d5" letter-spacing="6">TIME</text>`)],
  31: ["Formas", "Sol retrô", art(`<g clip-path="url(#c31)"><circle cx="300" cy="300" r="250" fill="url(#g31)"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect y="${330 + i * 42}" width="600" height="${6 + i * 5}" fill="#171a25"/>`).join("")}</g>`, `<clipPath id="c31"><circle cx="300" cy="300" r="250"/></clipPath><linearGradient id="g31" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffd23f"/><stop offset=".55" stop-color="#ff5a67"/><stop offset="1" stop-color="#8338ec"/></linearGradient>`)],
  32: ["Ícones", "Arco-íris", art(`${["#ff595e", "#ff924c", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"].map((c, i) => `<path d="M${70 + i * 32} 420 A${230 - i * 32} ${230 - i * 32} 0 0 1 ${530 - i * 32} 420" fill="none" stroke="${c}" stroke-width="34"/>`).join("")}<g fill="#fff" stroke="#cfd8e3" stroke-width="6"><path d="M40 470 Q40 410 100 415 Q120 370 170 395 Q215 390 215 440 Q240 470 205 490 L70 490 Q40 490 40 470 Z"/><path d="M385 470 Q385 410 445 415 Q465 370 515 395 Q560 390 560 440 Q585 470 550 490 L415 490 Q385 490 385 470 Z"/></g>`)],
  33: ["Ícones", "Patinha", art(`<g fill="#171a25"><ellipse cx="300" cy="400" rx="135" ry="115"/><ellipse cx="160" cy="250" rx="55" ry="72" transform="rotate(-20 160 250)"/><ellipse cx="250" cy="165" rx="55" ry="75" transform="rotate(-6 250 165)"/><ellipse cx="350" cy="165" rx="55" ry="75" transform="rotate(6 350 165)"/><ellipse cx="440" cy="250" rx="55" ry="72" transform="rotate(20 440 250)"/></g>`)],
  34: ["Natureza", "Folha", art(`<path d="M300 560 Q120 470 110 300 Q100 130 300 40 Q500 130 490 300 Q480 470 300 560 Z" fill="#40916c"/><path d="M300 560 L300 80" stroke="#1b4332" stroke-width="12" stroke-linecap="round"/>${[140, 220, 300, 380].map((y, i) => `<path d="M300 ${y + 40} Q${210 - i * 5} ${y} ${150 + i * 10} ${y - 20}" fill="none" stroke="#1b4332" stroke-width="8" stroke-linecap="round"/><path d="M300 ${y + 40} Q${390 + i * 5} ${y} ${450 - i * 10} ${y - 20}" fill="none" stroke="#1b4332" stroke-width="8" stroke-linecap="round"/>`).join("")}`)],
  35: ["Formas", "Diamante", art(`<polygon points="150,200 450,200 550,280 300,540 50,280" fill="#48cae4"/><polygon points="150,200 220,280 50,280" fill="#90e0ef"/><polygon points="450,200 380,280 550,280" fill="#0096c7"/><polygon points="220,280 380,280 300,540" fill="#00b4d8"/><polygon points="150,200 300,200 220,280" fill="#caf0f8"/><polygon points="300,200 450,200 380,280" fill="#ade8f4"/><polygon points="220,280 300,200 380,280" fill="#e0fbfc"/><polyline points="150,200 450,200 550,280 300,540 50,280 150,200" fill="none" stroke="#023e8a" stroke-width="10" stroke-linejoin="round"/>`)],
  36: ["Formas", "Colmeia", art([[300, 300], [300, 160], [300, 440], [179, 230], [421, 230], [179, 370], [421, 370]].map(([x, y], i) => `<polygon points="${hex(x, y, 78)}" fill="${["#ffb703", "#fb8500", "#ffd166", "#f4a261", "#e9c46a", "#ffb703", "#fb8500"][i]}" stroke="#171a25" stroke-width="8"/>`).join(""))],
  37: ["Frases", "Love", art(`<path d="M300 300 C210 240 170 180 200 135 C230 90 285 100 300 145 C315 100 370 90 400 135 C430 180 390 240 300 300 Z" fill="#ff4d6d"/><text x="300" y="470" text-anchor="middle" font-size="190" ${display} fill="#171a25" letter-spacing="4">LOVE</text>`)],
  38: ["Natureza", "Borboleta", art(`<g stroke="#171a25" stroke-width="8"><path d="M295 290 C230 90 60 70 70 200 C80 300 200 310 295 300 Z" fill="#8338ec"/><path d="M305 290 C370 90 540 70 530 200 C520 300 400 310 305 300 Z" fill="#8338ec"/><path d="M295 310 C200 320 110 400 160 470 C210 530 280 430 295 330 Z" fill="#ff006e"/><path d="M305 310 C400 320 490 400 440 470 C390 530 320 430 305 330 Z" fill="#ff006e"/></g><circle cx="170" cy="190" r="28" fill="#ffd23f"/><circle cx="430" cy="190" r="28" fill="#ffd23f"/><rect x="288" y="200" width="24" height="240" rx="12" fill="#171a25"/><path d="M295 205 Q260 140 240 120 M305 205 Q340 140 360 120" fill="none" stroke="#171a25" stroke-width="8" stroke-linecap="round"/>`)],
  39: ["Ícones", "Notas musicais", art(`<g fill="#171a25"><ellipse cx="190" cy="450" rx="70" ry="52" transform="rotate(-20 190 450)"/><ellipse cx="430" cy="400" rx="70" ry="52" transform="rotate(-20 430 400)"/><rect x="240" y="120" width="24" height="335"/><rect x="480" y="70" width="24" height="335"/><polygon points="240,120 504,70 504,150 240,200"/></g><ellipse cx="170" cy="435" rx="18" ry="10" fill="#fff" opacity=".5" transform="rotate(-20 170 435)"/>`)],
  40: ["Ícones", "Planeta", art(`<circle cx="300" cy="300" r="150" fill="#ff7b54"/><path d="M175 230 Q300 260 425 230" stroke="#ffb26b" stroke-width="22" fill="none"/><path d="M160 320 Q300 350 440 320" stroke="#e85d3f" stroke-width="18" fill="none"/><ellipse cx="300" cy="300" rx="270" ry="70" fill="none" stroke="#ffd56b" stroke-width="26" transform="rotate(-18 300 300)"/><path d="M152 285 A150 150 0 0 1 448 315" fill="none" stroke="#ff7b54" stroke-width="40" transform="rotate(-18 300 300)" opacity="0"/><polygon points="${starPoints(90, 110, 26, 10)}" fill="#ffd23f"/><polygon points="${starPoints(510, 500, 22, 8)}" fill="#ffd23f"/><circle cx="520" cy="120" r="10" fill="#ffd23f"/>`)],
  41: ["Ícones", "Coroa", art(`<polygon points="80,440 110,160 210,300 300,110 390,300 490,160 520,440" fill="#ffc300" stroke="#b07d00" stroke-width="14" stroke-linejoin="round"/><rect x="80" y="440" width="440" height="70" rx="14" fill="#ffaa00" stroke="#b07d00" stroke-width="14"/><circle cx="300" cy="475" r="22" fill="#e63946"/><circle cx="190" cy="475" r="16" fill="#3a86ff"/><circle cx="410" cy="475" r="16" fill="#3a86ff"/><circle cx="110" cy="160" r="22" fill="#e63946"/><circle cx="300" cy="110" r="24" fill="#e63946"/><circle cx="490" cy="160" r="22" fill="#e63946"/>`)],
  42: ["Ícones", "Âncora", art(`<g fill="none" stroke="#14213d" stroke-width="34" stroke-linecap="round"><circle cx="300" cy="105" r="50"/><path d="M300 155 L300 520"/><path d="M200 220 L400 220"/><path d="M110 380 Q130 520 300 520 Q470 520 490 380"/></g><polygon points="80,400 140,330 160,420" fill="#14213d"/><polygon points="520,400 460,330 440,420" fill="#14213d"/>`)],
  43: ["Frases", "Feito com amor", art(`<circle cx="300" cy="300" r="270" fill="#ffe5ec"/><circle cx="300" cy="300" r="250" fill="none" stroke="#ff4d6d" stroke-width="10"/><circle cx="300" cy="300" r="165" fill="none" stroke="#ff4d6d" stroke-width="6" stroke-dasharray="4 12" stroke-linecap="round"/><path id="t43" d="M100 300 A200 200 0 0 1 500 300" fill="none"/><path id="b43" d="M95 300 A205 205 0 0 0 505 300" fill="none"/><text font-size="56" ${display} fill="#c9184a" letter-spacing="6"><textPath href="#t43" startOffset="50%" text-anchor="middle">FEITO COM</textPath></text><text font-size="56" ${display} fill="#c9184a" letter-spacing="8"><textPath href="#b43" startOffset="50%" text-anchor="middle" dominant-baseline="hanging">AMOR</textPath></text><path d="M300 380 C230 330 200 285 222 250 C245 215 288 222 300 258 C312 222 355 215 378 250 C400 285 370 330 300 380 Z" fill="#ff4d6d"/>`)],
};

const manifest = [];
for (const [n, [category, name, svg]] of Object.entries(designs)) {
  out(`img/estampas/estampa-${n}.svg`, svg);
  manifest.push({ n: Number(n), category, name });
}
out("img/estampas/estampas.json", JSON.stringify(manifest, null, 2));

/* Ícone do app */
out(
  "icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#171a25"/>
  <path d="M176 150 Q256 196 336 150 L414 182 L462 262 L408 300 L372 276 L372 382 Q372 396 358 396 L154 396 Q140 396 140 382 L140 276 L104 300 L50 262 L98 182 Z" fill="#ff5a67"/>
  <path d="M176 150 Q256 210 336 150" fill="none" stroke="#171a25" stroke-width="14" stroke-linecap="round"/>
  <polygon points="${starPoints(256, 290, 58, 24)}" fill="#fff"/>
</svg>`
);

console.log(`Gerados: 5 mockups, ${manifest.length} estampas, icon.svg`);
