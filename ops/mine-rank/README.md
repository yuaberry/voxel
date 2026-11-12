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

> **Nota para o futuro domínio/host próprio**: `server-ip=127.0.0.1` e a
> porta local servem para o jogo na mesma máquina. Num VPS com domínio, o
> `server-ip` precisa ficar vazio (para escutar em todas as interfaces) e
> o proxy/porta 25565 precisa estar aberto — o `deployment_ssh_*` do
> backend Rust já faz o deploy, mas ainda não tem interface.
