import { Commands } from "./components/Commands";
import { Dedication, Reference } from "./components/Reference";
import { Hero } from "./components/Hero";
import { Nav } from "./components/Nav";
import { Progress } from "./components/Progress";
import { Proof } from "./components/Proof";
import { World } from "./components/World";
import { Section } from "./components/ui";
import { ArrowIcon, PickaxeIcon } from "./components/Icons";

function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background/60 py-12">
      <div className="shell">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <p className="flex items-center gap-2 text-sm font-bold">
              <PickaxeIcon className="h-4 w-4 text-primary" />
              MINE <span className="brand-text">RANK</span>
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Um módulo do VOXEL — AI-Powered Creation Platform. O datapack, o gerador
              e este site são originais do VOXEL. Inspirado no Rankup público do{" "}
              <a href="https://nerdzone.gg" target="_blank" rel="noreferrer" className="link">
                NerdZone.gg
              </a>
              , com a devida homenagem.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-xs">
            <div>
              <p className="font-semibold text-foreground">Navegar</p>
              <ul className="mt-3 space-y-1.5 text-muted-foreground">
                <li>
                  <a href="#comandos" className="transition-colors hover:text-foreground">
                    Comandos
                  </a>
                </li>
                <li>
                  <a href="#progressao" className="transition-colors hover:text-foreground">
                    Progressão
                  </a>
                </li>
                <li>
                  <a href="#mundo" className="transition-colors hover:text-foreground">
                    Mundo
                  </a>
                </li>
                <li>
                  <a href="#referencia" className="transition-colors hover:text-foreground">
                    Referência
                  </a>
                </li>
                <li>
                  <a href="#dedicatoria" className="transition-colors hover:text-foreground">
                    Dedicação
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Projeto</p>
              <ul className="mt-3 space-y-1.5 text-muted-foreground">
                <li>
                  <a
                    href="https://github.com/yuaberry/voxel"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-foreground"
                  >
                    Código no GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/yuaberry/voxel/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-foreground"
                  >
                    Downloads do VOXEL
                  </a>
                </li>
                <li>
                  <a
                    href="https://yuaberry.github.io/voxel/"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-foreground"
                  >
                    Site do VOXEL
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-border/50 pt-6 text-[11px] leading-relaxed text-muted-foreground/80">
          <p>
            A VOXEL é uma plataforma de criação independente de terceiros e não é
            afiliada à Mojang Studios, à Microsoft, ao NerdZone.gg nem a qualquer
            outro servidor. Minecraft é uma marca da Mojang Studios/Microsoft — sem
            afiliação e sem redistribuição de arquivos proprietários.
          </p>
          <p className="mt-2 italic">
            “VOXEL is an independent third-party creation platform and is not
            affiliated with Mojang Studios or Microsoft.”
          </p>
          <p className="mt-2">
            © {new Date().getFullYear()} VOXEL · Mine Rank. Feito para quem minerou
            fundo demais pelo menos uma vez.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main>
        <Hero />

        <Section
          id="comandos"
          eyebrow="A superfície"
          title={`${39} comandos, um único manifesto`}
          lead="No Minecraft puro o único comando de jogador é o /trigger. Por isso cada comando do Mine Rank é um /trigger com um número — e os menus do chat são clicáveis: cada botão já executa o comando certo."
        >
          <Commands />
        </Section>

        <Section
          id="progressao"
          eyebrow="A progressão"
          title="Do Novato ao Mítico — e o prestígio que muda tudo"
          lead="Cada bloco minerado vale 1 level e 1 coin. A cada 100 blocos a mina se restaura sozinha. No level 1000 o prestígio zera o level e dá +1 coin por bloco para sempre."
        >
          <Progress />
        </Section>

        <Section
          id="mundo"
          eyebrow="O mundo"
          title="Um hub, oito minas, um lago e uma arena"
          lead="O mundo nasce junto com o datapack: uma plataforma própria acima de qualquer terreno, com o hub no centro, os terrenos em grade e as áreas sociais logo ao lado."
        >
          <World />
        </Section>

        <Section
          id="referencia"
          eyebrow="A referência"
          title="O Rankup que inspirou — e o que o vanilla permite"
          lead="A referência pública do NerdZone mostrou o conjunto de comandos do Rankup e o que cada um significa. Aqui está o que cada comando virou — e onde o vanilla simplesmente não deixa ir."
        >
          <Reference />
        </Section>

        <Section
          id="prova"
          eyebrow="A prova"
          title="Testado num servidor de verdade, não num mock"
          lead="O E2E do VOXEL baixa o jar vanilla oficial, entra com um cliente real, dispara todos os comandos e verifica o log do servidor. Foi assim que oito bugs do vanilla apareceram."
        >
          <Proof />
        </Section>

        <Section
          id="dedicatoria"
          eyebrow="Com respeito"
          title="A dedicatória"
        >
          <Dedication />
        </Section>

        <div className="shell pb-16">
          <a
            href="#top"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowIcon className="h-3.5 w-3.5 -rotate-90" />
            Voltar ao topo
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}
