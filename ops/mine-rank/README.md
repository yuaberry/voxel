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
| Memória | `-Xms512M -Xmx2G` |
| Reinício | `Restart=always`, `RestartSec=10` |
| Encerramento | `SIGTERM` + 90 s para o mundo ser salvo |
| Tick | `max-tick-time=0` (watchdog **desligado**) · `sync-chunk-writes=false` (ver abaixo) |

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
