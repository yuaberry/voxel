# Mine Rank — o servidor local como serviço do usuário

O servidor do Mine Rank é um Minecraft **vanilla 1.20.1** (o datapack
`nexus_rank` vive em `world/datapacks/nexus_rank`). Ele precisa:

1. **ficar no ar** — o dono joga nele; um servidor morto é um servidor
   que recusa a conexão ("Conexão recusada" no log do cliente);
2. **nunca ser duplicado** — dois servidores escrevendo no mesmo mundo
   corrompem os *region files* (o `start-server.sh` recusa se a porta
   25565 já estiver ocupada);
3. **ter um console vivo** — o `cmd.fifo` é o stdin do servidor, então
   um comando pode ser enviado sem reiniciar nada.

## Instalação

```bash
# 1. o script de start (com o FIFO do console)
install -m 755 ops/mine-rank/start-server.sh \
  ~/Voxel/servers/mine-rank/start-server.sh

# 2. a unit do systemd (usuário)
install -m 644 ops/mine-rank/voxel-mine-rank.service \
  ~/.config/systemd/user/voxel-mine-rank.service

# 3. subir e deixar para sempre
systemctl --user daemon-reload
systemctl --user enable --now voxel-mine-rank.service
```

Com `loginctl enable-linger $USER` o serviço sobe **sem ninguém logado**
(é o que mantém o servidor no ar depois de um reboot).

## Console

```bash
echo "say olá" > ~/Voxel/servers/mine-rank/cmd.fifo
tail -f ~/Voxel/servers/mine-rank/console.log
```

Comandos úteis: `stop`, `save-all flush`, `list`, `tps` (o vanilla 1.20.1
não tem `tps` — o TPS se mede com `time query gametime`).

## Estado

| Item | Valor |
|---|---|
| Porta | `25565` (loopback) |
| Versão | vanilla 1.20.1 (protocolo 763) |
| Modos | `online-mode=false` (o servidor local aceita a conta do dono sem verificação Mojang) |
| Memória | `-Xms256M -Xmx1G` (**right-sized** — o `-Xmx2G` antigo empurrava o servidor para o swap e o GC pausava por segundos) · limites do systemd: `MemoryMax=1536M`, `MemorySwapMax=0` |
| Reinício | `Restart=always`, `RestartSec=10` |
| Encerramento | `SIGTERM` + 90 s para o mundo ser salvo |
| Tick | `max-tick-time=0` (watchdog **desligado**) · `sync-chunk-writes=false` (ver abaixo) |
| Resource pack | `resource-pack-sha1=<sha1 do nexus_rank>` já registrado; **sem URL** enquanto o servidor é só local (ver abaixo) |

## A capa e a descrição do servidor (tela Multiplayer)

O ícone (`server-icon.png`) é gerado pelo VOXEL — 64×64 RGBA, o único tamanho
que o cliente vanilla lê. Sem ele o servidor aparece com a marca cinza de
"desconhecido" na tela de todos os jogadores.

A descrição (`motd` no `server.properties`) usa códigos de cor e **duas
linhas** — a quebra de linha são os dois caracteres barra + n, nunca uma
quebra real (uma quebra real corta o `server.properties` e a segunda linha
some sem aviso; medido no servidor ao vivo).

```
motd=§6§lMINE RANK §8▪ §fRankup 100% vanilla 1.20.1\n§7/mina §8· §7/encantos §8· §eMineCoin §8· §f8 minas privadas
```

**As propriedades só valem no START do servidor** — um `/reload` recarrega os
datapacks, não o `server.properties`. Mexeu no `motd` ou no ícone?
`systemctl --user restart voxel-mine-rank.service`.

O ícone deste servidor está versionado em `ops/mine-rank/server-icon.png` e é
gerado de novo a cada servidor criado pelo VOXEL (`server_icon_png`, em
`src-tauri/src/commands/servers.rs`), com teste que confere as dimensões, a
assinatura e o tamanho mínimo da arte.

## A mina ficou menor (sessão 82) — e o reset agora é derivado

A mina privada passou de **3×3 × 8 camadas (72 blocos)** para
**3×3 × 5 camadas (45 blocos)**: carvão, ferro, ouro, diamante e esmeralda
(de cima para baixo). Os **ranks não mudaram** — os 8 tiers são por *nível*
(0/100/250/450/650/800/950/1000), nunca por camada de minério.

Duas coisas que só funcionam juntas:

| Item | Antes | Agora |
|---|---|---|
| Camadas de minério | 8 (com cobre, redstone e lápis) | **5** (carvão → ferro → ouro → diamante → esmeralda) |
| Restauração automática | 100 blocos **escritos à mão** | **27 blocos, derivados** do volume (60% de 45) |
| Restauração das minas de Pré-Rank | o mesmo 100 (emprestado) | **88 blocos**, derivados do volume delas (60% de 147) |

**Por que o reset tinha que mudar junto**: com 8 camadas a mina já tinha
72 blocos e o restore pedia 100 — ele só disparava depois de você cavar
**mais** blocos do que a mina tem (ou cavar as paredes do poço). Com 45
blocos, um limite de 100-nunca-dispersaria: a mina esvaziaria e ficaria
vazia para sempre até o reset manual (25 coins). Os dois testes em
`src/services/servers/mineRankServer.test.ts` (`restores every mine while
it still has ore in it`) seguram esse acoplamento.

### Migrar um mundo que já existe

A geometria nova **não** se aplica sozinha a um mundo já gerado — o poço
antigo (8 camadas, até y=91) continua no disco. Para reconstruir um terreno
com a geometria nova, pelo console do servidor (ou pelo Console do VOXEL):

```bash
# terreno 1 (centro em x=20 z=20). Troque as coordenadas por terreno.
fill 18 88 18 22 99 22 minecraft:air     # limpa o poço antigo
function nexus_rank:build_plot_1        # reconstrói com a geometria nova
```

Centro de cada terreno: `1→(20,20) 2→(36,20) 3→(52,20) 4→(68,20)
5→(20,36) 6→(36,36) 7→(52,36) 8→(68,36)`.

> **Atenção**: o `fill` apaga TUDO o que estiver construído dentro daquele
> poço (o deck e o anel colorido ficam de fora). Rode só no terreno que for
> usar, e de preferência com o servidor parado ou com ninguém dentro dele.
> Um mundo novo (servidor recém-criado) já nasce com a geometria nova.

## O resource pack da picareta

A picareta customizada (`CustomModelData:1`) precisa de um resource pack
para mostrar a textura própria. **Um datapack não pode carregar um
resource pack** — o vanilla ignora a pasta `resource_pack/` dentro de
`world/datapacks/`. O caminho vanilla é o servidor **empurrar** o pack:

```
resource-pack=<URL HTTP do .zip>
resource-pack-sha1=<sha1 do mesmo zip>
```

O SHA-1 já está gravado no `server.properties` (o zip é
`world/datapacks/nexus_rank/resource_pack/` compactado com `pack.mcmeta`
na raiz). Falta a **URL**: um servidor local em loopback não tem uma.

**Enquanto é local**, o pack é instalado no **cliente**:

```bash
# o zip dentro da resourcepacks da instância (o cliente carrega sozinho)
cp nexus_rank_rp.zip ~/Voxel/instances/mine-rank/resourcepacks/mine-rank-pickaxe.zip
# e entra na lista de packs ativos (senão o dono teria que ligar à mão)
sed -i 's/resourcePacks:\[\]/resourcePacks:["vanilla","mine-rank-pickaxe"]/' \
  ~/Voxel/instances/mine-rank/options.txt
```

> **Quando o servidor for público** (VPS com domínio), hospede o zip e
> preencha `resource-pack=https://…` — a textura passa a chegar em
> qualquer cliente sem instalar nada.


## O watchdog e os "Can't keep up"

O vanilla 1.20.1 tem um watchdog: se um **único tick** passa de
`max-tick-time`, ele mata o servidor (*"A single server tick took 95.91
seconds"* → *"Considering it to be crashed"*). Com o valor default
(60 s) e a máquina do dono compartilhada com o **launcher, o cliente do
Minecraft e as compilações do VOXEL** (cargo + vitest), um pico de I/O
deixava o tick sem CPU por mais de um minuto — e o servidor morria
**no meio do jogo do dono**.

Duas properties resolvem isso, e as duas são padrão do vanilla:

| Property | Antes | Agora | Por quê |
|---|---|---|---|
| `max-tick-time` | `60000` | `0` | **desliga o watchdog** — um tick lento não vira morte do servidor |
| `sync-chunk-writes` | `true` | `false` | o autosave deixa de segurar o thread do servidor (é a origem dos picos de *"Can't keep up"*) |

**Por que `0` e não um valor alto?** Porque o problema **não** era o
tempo do tick: era o **watchdog medindo errado**. A prova está no
crash report de 21:46 — o Server thread estava em `TIMED_WAITING`,
que é o estado **normal** entre ticks (parcado, esperando o
próximo):

```
"Server thread" prio=5 Id=36 TIMED_WAITING on java.lang.String@49d113c8
	at java.base@21.0.12.1/jdk.internal.misc.Unsafe.park(Native Method)
	at bcn.bq(SourceFile:151)
```

Ou seja: o servidor estava **saudável**; quem não pôde medir foi a
**própria thread do watchdog**, que não ganhou CPU. Qualquer valor
alto só adia a morte (o servidor morreu de novo com `120000`, aos
120 s). Desligar o watchdog é o que resolve — e é comportamento
**vanilla**, não gambiarra: no bytecode oficial, a thread do watchdog
só é criada quando o valor lido de `max-tick-time` é **maior que
zero** (`bj()` → `ahf.C:J` → `if (bj() <= 0)` pula a criação).

**O que substitui o watchdog?** O `Restart=always` do systemd, que já
foi provado: 21:36:24 → 21:36:34, 21:46:40 → 21:46:50. E, se o
processo travar de verdade, o `systemctl --user restart` resolve.

**Custo honesto da escolha**: com o watchdog desligado, um tick
**realmente travado** (loop infinito num comando do datapack) não
mata o servidor sozinho — ele fica lento até alguém reiniciar. É uma
troca consciente: nesta máquina, o servidor do dono **nunca** deve
morrer por causa de uma compilação paralela, e um travamento real é
raro num datapack sem loopsiving.

> **Diagnóstico do mundo (2026-11-11)**: os erros `"stream is truncated"`
> no log **não** significam corrupção. Os *region files* foram
> validados com o formato vanilla correto (**offset em setores de 4096
> bytes**; o `length` do header **inclui** o byte de compressão):
> **1007 chunks, 0 corrompidos**. Erros de leitura assim aparecem
> quando o chunk está sendo reescrito no meio de um autosave.

## Estado

> **Nota para o futuro domínio/host próprio**: `server-ip=127.0.0.1` e a
> porta local servem para o jogo na mesma máquina. Num VPS com domínio, o
> `server-ip` precisa ficar vazio (para escutar em todas as interfaces) e
> o proxy/porta 25565 precisa estar aberto — o `deployment_ssh_*` do
> backend Rust já faz o deploy, mas ainda não tem interface.
