import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repoRoot, "client", "dist");
const assetsRoot = path.join(distRoot, "assets");

function findAssetByPattern(pattern) {
  return fs.readdirSync(assetsRoot).find((entry) => pattern.test(entry)) || null;
}

function writeCompatibleSecurityChunk(targetPath, mainAsset, pageHeaderAsset) {
  const tabs = [
    { key: "users", label: "Usuarios" },
    { key: "audit", label: "Auditoria" },
    { key: "counter-key", label: "Contra-senha" },
  ];
  const cards = [
    { title: "Usuarios monitorados", value: "24", detail: "Perfis operacionais, gestores e administradores." },
    { title: "Eventos auditaveis", value: "128", detail: "Acesso, menus sensiveis e comandos enviados." },
    { title: "Fluxo contra-senha", value: "Ativo", detail: "Pronto para operar com ES Jammer e ESP32." },
  ];
  const userRows = [
    { name: "Operador Matriz", profile: "Supervisor", device: "ESP32-BASE-01", state: "ONLINE", action: "Acesso validado" },
    { name: "Base Norte", profile: "Monitor", device: "ESP32-BASE-07", state: "TENTANDO", action: "Sincronizando heartbeat" },
    { name: "Auditoria", profile: "Compliance", device: "Console web", state: "ATIVO", action: "Consulta de historico" },
  ];
  const auditRows = [
    { event: "Login administrativo", area: "Sessao", result: "Sucesso", when: "Hoje, 00:22" },
    { event: "Abertura de monitoramento", area: "Mapa", result: "Sucesso", when: "Hoje, 00:24" },
    { event: "Preview senha/contra", area: "Seguranca", result: "Aguardando", when: "Hoje, 00:26" },
  ];
  const flowSteps = [
    "Receber challenge do dispositivo ou operador.",
    "Validar operador, cliente e janela de seguranca.",
    "Gerar contra-senha e registrar auditoria.",
    "Confirmar retorno do dispositivo e fechar tentativa.",
  ];

  const source = `import{r as React,j as jsx}from"./${mainAsset}";import{P as PageHeader}from"./${pageHeaderAsset}";
const TABS=${JSON.stringify(tabs)};
const CARDS=${JSON.stringify(cards)};
const USER_ROWS=${JSON.stringify(userRows)};
const AUDIT_ROWS=${JSON.stringify(auditRows)};
const FLOW_STEPS=${JSON.stringify(flowSteps)};
function StatCard({title,value,detail}){return jsx.jsxs("div",{className:"rounded-2xl border border-white/10 bg-white/5 p-4",children:[jsx.jsx("div",{className:"text-[11px] uppercase tracking-[0.12em] text-white/45",children:title}),jsx.jsx("div",{className:"mt-3 text-2xl font-semibold text-white",children:value}),jsx.jsx("p",{className:"mt-2 text-sm text-white/65",children:detail})]})}
function TabButton({active,children,onClick}){return jsx.jsx("button",{type:"button",onClick,className:\`rounded-full border px-4 py-2 text-sm transition \${active?"border-sky-400/50 bg-sky-500/15 text-white":"border-white/10 bg-white/5 text-white/65 hover:border-white/25 hover:text-white"}\`,children})}
function StateBadge({value}){const tone=value==="ONLINE"?"border-emerald-400/30 bg-emerald-500/15 text-emerald-200":value==="TENTANDO"?"border-amber-400/30 bg-amber-500/15 text-amber-100":"border-sky-400/30 bg-sky-500/15 text-sky-100";return jsx.jsx("span",{className:\`rounded-full border px-2 py-1 text-[11px] font-semibold \${tone}\`,children:value})}
function UsersPanel(){return jsx.jsxs("div",{className:"overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c]",children:[jsx.jsxs("div",{className:"border-b border-white/10 px-5 py-4",children:[jsx.jsx("h3",{className:"text-base font-semibold text-white",children:"Painel de usuarios"}),jsx.jsx("p",{className:"mt-1 text-sm text-white/60",children:"Visao operacional dos acessos, heartbeat dos dispositivos e ultima acao registrada."})]}),jsx.jsx("div",{className:"overflow-x-auto",children:jsx.jsxs("table",{className:"min-w-full text-sm",children:[jsx.jsx("thead",{className:"bg-white/[0.03] text-white/55",children:jsx.jsxs("tr",{children:[jsx.jsx("th",{className:"px-4 py-3 text-left font-medium",children:"Usuario"}),jsx.jsx("th",{className:"px-4 py-3 text-left font-medium",children:"Perfil"}),jsx.jsx("th",{className:"px-4 py-3 text-left font-medium",children:"Dispositivo"}),jsx.jsx("th",{className:"px-4 py-3 text-left font-medium",children:"Estado"}),jsx.jsx("th",{className:"px-4 py-3 text-left font-medium",children:"Ultima acao"})]})}),jsx.jsx("tbody",{children:USER_ROWS.map(row=>jsx.jsxs("tr",{className:"border-t border-white/6",children:[jsx.jsx("td",{className:"px-4 py-3 text-white",children:row.name}),jsx.jsx("td",{className:"px-4 py-3 text-white/70",children:row.profile}),jsx.jsx("td",{className:"px-4 py-3 text-white/70",children:row.device}),jsx.jsx("td",{className:"px-4 py-3",children:jsx.jsx(StateBadge,{value:row.state})}),jsx.jsx("td",{className:"px-4 py-3 text-white/70",children:row.action})]},row.name+":"+row.device))})]})})]})}
function AuditPanel(){return jsx.jsxs("div",{className:"grid gap-4 lg:grid-cols-[1.3fr_.7fr]",children:[jsx.jsxs("div",{className:"overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c]",children:[jsx.jsxs("div",{className:"border-b border-white/10 px-5 py-4",children:[jsx.jsx("h3",{className:"text-base font-semibold text-white",children:"Auditoria operacional"}),jsx.jsx("p",{className:"mt-1 text-sm text-white/60",children:"Eventos que precisam ficar visiveis para seguranca, atendimento e compliance."})]}),jsx.jsx("div",{className:"space-y-3 p-5",children:AUDIT_ROWS.map(row=>jsx.jsxs("div",{className:"rounded-xl border border-white/8 bg-white/[0.03] p-4",children:[jsx.jsxs("div",{className:"flex flex-wrap items-center justify-between gap-2",children:[jsx.jsx("div",{className:"text-sm font-medium text-white",children:row.event}),jsx.jsx("span",{className:"rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/65",children:row.when})]}),jsx.jsxs("div",{className:"mt-2 text-sm text-white/65",children:[jsx.jsxs("span",{className:"mr-4",children:["Area: ",row.area]}),jsx.jsxs("span",{children:["Resultado: ",row.result]})]})]},row.event+":"+row.when))})]}),jsx.jsxs("div",{className:"rounded-2xl border border-white/10 bg-white/5 p-5",children:[jsx.jsx("h3",{className:"text-base font-semibold text-white",children:"Cobertura minima"}),jsx.jsxs("ul",{className:"mt-4 space-y-3 text-sm text-white/65",children:[jsx.jsx("li",{children:"Login e troca de contexto."}),jsx.jsx("li",{children:"Abertura de telas sensiveis."}),jsx.jsx("li",{children:"Geracao de contra-senha."}),jsx.jsx("li",{children:"Falhas de validacao e reenvio."}),jsx.jsx("li",{children:"Heartbeat dos ESP32 vinculados."})]})]})]})}
function CounterKeyPanel(){return jsx.jsxs("div",{className:"grid gap-4 lg:grid-cols-[.9fr_1.1fr]",children:[jsx.jsxs("div",{className:"rounded-2xl border border-white/10 bg-white/5 p-5",children:[jsx.jsx("h3",{className:"text-base font-semibold text-white",children:"Fluxo de contra-senha"}),jsx.jsx("ol",{className:"mt-4 space-y-3 text-sm text-white/65",children:FLOW_STEPS.map((step,index)=>jsx.jsxs("li",{className:"flex gap-3",children:[jsx.jsx("span",{className:"mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-semibold text-sky-100",children:index+1}),jsx.jsx("span",{children:step})]},step))})]}),jsx.jsxs("div",{className:"rounded-2xl border border-white/10 bg-[#0f141c] p-5",children:[jsx.jsx("h3",{className:"text-base font-semibold text-white",children:"Preview operacional"}),jsx.jsxs("div",{className:"mt-4 grid gap-3 md:grid-cols-2",children:[jsx.jsxs("div",{className:"rounded-xl border border-white/8 bg-white/[0.03] p-4",children:[jsx.jsx("div",{className:"text-[11px] uppercase tracking-[0.12em] text-white/45",children:"Challenge"}),jsx.jsx("div",{className:"mt-2 text-xl font-semibold text-white",children:"482913"}),jsx.jsx("p",{className:"mt-2 text-sm text-white/60",children:"Recebido do ESP32 da base principal."})]}),jsx.jsxs("div",{className:"rounded-xl border border-white/8 bg-white/[0.03] p-4",children:[jsx.jsx("div",{className:"text-[11px] uppercase tracking-[0.12em] text-white/45",children:"Contra-senha"}),jsx.jsx("div",{className:"mt-2 text-xl font-semibold text-white",children:"938241"}),jsx.jsx("p",{className:"mt-2 text-sm text-white/60",children:"Exemplo visual para o fluxo operacional."})]})]}),jsx.jsxs("div",{className:"mt-4 flex flex-wrap gap-3",children:[jsx.jsx("button",{type:"button",className:"rounded-xl border border-sky-400/35 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-50",children:"Preview senha/contra"}),jsx.jsx("button",{type:"button",className:"rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70",children:"Rotacionar challenge"})]})]})]})}
function SecurityCenter00h22(){const[tab,setTab]=React.useState("users");let panel=jsx.jsx(UsersPanel,{});if(tab==="audit")panel=jsx.jsx(AuditPanel,{});else if(tab==="counter-key")panel=jsx.jsx(CounterKeyPanel,{});return jsx.jsxs("div",{className:"space-y-6",children:[jsx.jsx(PageHeader,{}),jsx.jsxs("div",{className:"rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-6 shadow-[0_30px_80px_rgba(2,6,23,0.45)]",children:[jsx.jsxs("div",{className:"flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between",children:[jsx.jsxs("div",{className:"max-w-3xl",children:[jsx.jsx("div",{className:"inline-flex items-center rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100",children:"Seguranca"}),jsx.jsx("h1",{className:"mt-4 text-3xl font-semibold tracking-tight text-white",children:"Central de Seguranca"}),jsx.jsx("p",{className:"mt-3 text-sm leading-6 text-white/65",children:"Painel de usuarios, auditoria e geracao de contra-senha para a operacao ES Jammer e ESP32."})]}),jsx.jsx("div",{className:"grid gap-3 sm:grid-cols-3",children:CARDS.map(card=>jsx.jsx(StatCard,{...card},card.title))})]} )]}),jsx.jsx("div",{className:"flex flex-wrap gap-3",children:TABS.map(item=>jsx.jsx(TabButton,{active:tab===item.key,onClick:()=>setTab(item.key),children:item.label},item.key))}),panel]})}
export{SecurityCenter00h22 as default};
`;

  fs.writeFileSync(targetPath, source);
}

function main() {
  if (!fs.existsSync(assetsRoot)) {
    throw new Error(`assets ausente: ${assetsRoot}`);
  }

  const mainAsset = findAssetByPattern(/^index-.*\.js$/);
  const securityAsset = findAssetByPattern(/^Security-.*\.js$/);
  const pageHeaderAsset = findAssetByPattern(/^PageHeader-.*\.js$/);

  if (!mainAsset || !securityAsset || !pageHeaderAsset) {
    throw new Error(
      `Assets esperados ausentes: main=${mainAsset} security=${securityAsset} pageHeader=${pageHeaderAsset}`,
    );
  }

  writeCompatibleSecurityChunk(path.join(assetsRoot, securityAsset), mainAsset, pageHeaderAsset);
  process.stdout.write("OK: chunk compatível da Central de Seguranca aplicado\n");
}

main();
