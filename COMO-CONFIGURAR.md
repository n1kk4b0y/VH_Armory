# Configurar e abrir o VH Armory

Você configura tudo no arquivo **config.json**, na mesma pasta deste guia.
Abra-o no Bloco de Notas, altere os valores e salve. Não precisa configurar
variáveis de ambiente nem digitar comandos.

## Abrir no Windows

1. Extraia o ZIP inteiro para uma pasta.
2. Tenha o [Node.js LTS](https://nodejs.org/) instalado.
3. Edite `config.json` conforme um dos exemplos abaixo.
4. Abra **INICIAR-SITE.bat** com dois cliques.

Na primeira execução o inicializador instala as dependências e depois abre
o navegador. A instalação inicial precisa de internet. Mantenha a janela
que ele abriu funcionando; você pode minimizá-la. Fechar essa janela encerra
o site. Os ícones e o visualizador 3D já acompanham o pacote.

Se `web.openBrowser` estiver `false`, abra o endereço informado na janela.
O padrão é `http://localhost:3000`.

## Usar a pasta local

Em `config.json`, mantenha `sftp.enabled` como **false** e preencha
`local.worldPath` com a pasta do mundo:

```json
"local": {
  "worldPath": "C:/Users/fabio/curseforge/minecraft/Instances/Vault Hunters Third Edition - Remastered/saves/World",
  "instancePath": ""
}
```

Use barras `/` no caminho do Windows, como no exemplo. A raiz do mundo é
a pasta que contém `data`, `playerdata` e `stats`. Se deixar `data/world`,
o site lê os arquivos copiados para essa pasta dentro do projeto.

`instancePath` é opcional. Preencha quando as configurações ou a pasta
`playerSnapshots` estiverem em uma raiz diferente da estrutura habitual
da instância. Vazio mantém a busca automática existente.

## Usar o SFTP

Preencha os dados fornecidos pela hospedagem e mude **enabled** para **true**:

```json
"sftp": {
  "enabled": true,
  "host": "sftp.exemplo.com",
  "port": 22,
  "username": "seu_usuario",
  "password": "sua_senha",
  "remoteWorldPath": "/world",
  "remoteInstancePath": "/",
  "privateKeyPath": "",
  "passphrase": "",
  "hostFingerprint": "",
  "timeoutSeconds": 20,
  "maxFileSizeMB": 256
}
```

Este trecho substitui somente o bloco `sftp`; mantenha o restante do arquivo.
`host` recebe o endereço fornecido para SFTP. `port` recebe a porta desse
serviço. `remoteWorldPath` é a raiz do mundo vista pelo cliente SFTP, por
exemplo `/world` ou `/saves/World`, conforme a hospedagem.

`remoteInstancePath` indica a raiz que contém `config/the_vault`,
`playerSnapshots`, `usercache.json` ou `usernamecache.json`. É opcional:
quando vazio, o site procura também nos diretórios superiores do mundo.
Esses arquivos complementam nomes, builds, efeitos e regras da instância.
O SFTP busca somente os arquivos usados pelo dashboard e faz somente leitura
no servidor de Minecraft.

Para autenticar com chave SSH, preencha `privateKeyPath` com o caminho do
arquivo de chave privada neste computador, por exemplo `keys/id_ed25519`.
Preencha `passphrase` se a chave estiver protegida. `password` pode ficar
vazio nessa modalidade. Os campos de senha ficam no arquivo do servidor do
site; não são enviados à interface do navegador.

`hostFingerprint` é opcional e aceita a identidade SSH no formato `SHA256:...`.
Quando vazio, o site registra a chave recebida na primeira conexão autenticada
e passa a exigir a mesma chave nas conexões seguintes. Uma divergência é
exibida como erro, sem substituir automaticamente a identidade registrada.

## Regra de escolha da origem

| Configuração | Origem utilizada |
| --- | --- |
| `sftp.enabled: false` | Pasta definida em `local.worldPath` |
| `true`, mas host, usuário, pasta remota ou autenticação incompletos | Pasta local; a página avisa que o SFTP está incompleto |
| `true` e campos obrigatórios preenchidos | Servidor SFTP |
| SFTP preenchido, mas conexão ou autenticação falha | Erro visível; mantém a última leitura válida dessa mesma origem, se ela já estiver carregada |

Uma falha de conexão com dados preenchidos não muda silenciosamente para o
mundo local. Ao escolher um servidor diferente, dados da origem anterior
não são usados para representar esse novo servidor.

## Aplicar alterações e atualizar os dados

Depois de salvar o arquivo, clique em **Recarregar dados** no site. Isso relê
a configuração, permite alternar Local/SFTP e busca os dados novamente,
sem abrir um terminal. A recarga manual também força a leitura dos arquivos
remotos, mesmo quando tamanho e data de modificação não mudaram.

`refreshSeconds` controla a atualização automática. O padrão é **60** segundos;
use **0** para atualizar somente pelo botão. Valores positivos devem ser de
pelo menos 5 segundos. O site busca arquivos gravados pelo Minecraft, por isso
a informação nova aparece depois que o jogo a salvar. No SFTP, atualizações
automáticas reaproveitam arquivos cujo tamanho e data de modificação permanecem
iguais. A interface conserva a aba e só se atualiza quando detecta novos dados.

Alterações em `web.host`, `web.port` ou `web.openBrowser` são aplicadas ao
reiniciar o site. A origem dos dados não exige reinicialização.

## Hospedar em outra máquina

Para aceitar acesso pela rede, configure `web.host` como `0.0.0.0` e a porta
disponibilizada pela hospedagem. `local.worldPath` sempre se refere à máquina
que executa o Node.js. A mesma pasta do projeto e o mesmo arquivo de
configuração servem tanto para uso local quanto para hospedagem com SFTP.

## Corrigir erros de configuração

- `true` e `false` ficam sem aspas; textos e caminhos ficam entre aspas.
- Números, como porta e intervalo, ficam sem aspas.
- Não adicione vírgula depois do último campo de um bloco.
- Use `config.example.json` para recuperar o modelo original, se necessário.
- Se a pasta remota não for encontrada, confira o caminho exibido no cliente SFTP.
- Erros de rede, autenticação, chave SSH ou gravação incompleta aparecem na página.

O cache em `data/sftp-cache` guarda capturas locais e mantém as duas últimas
gerações por origem. A última captura só é publicada depois da transferência
e da leitura dos dados críticos. Se o site for encerrado sem conexão, essa
versão precisa restabelecer o SFTP para carregar os perfis novamente.

Quem já utiliza `VH_WORLD_PATH` ou `VH_PORT` ainda pode usá-los: essas duas
variáveis, quando presentes, têm prioridade sobre os respectivos campos do
arquivo. O uso normal pelo inicializador dispensa essas variáveis.
