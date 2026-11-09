# VH Armory — v22

Dashboard local para Vault Hunters Third Edition Remastered 20.0.3.
Mantém as telas da v17: jogadores, ranking, Overview, Statistics, Vaults,
Attributes, Gear, Companions, Abilities, Talents, Expertise, Research, Prestige, Bounties, Quests e Discoveries.

## V22 — pasta local ou SFTP pelo arquivo de configuração

Edite **config.json** no Bloco de Notas e abra **INICIAR-SITE.bat** com dois
cliques no Windows. Com Node.js instalado, o inicializador prepara as
dependências na primeira execução e abre o site no navegador.

- `sftp.enabled: false` usa `local.worldPath`.
- `true` com campos obrigatórios vazios também usa a pasta local e mostra
  um aviso de configuração incompleta.
- `true` com host, usuário, pasta remota e senha ou chave configurados usa SFTP.
- Salvar o arquivo e clicar em **Recarregar dados** aplica uma troca de
  origem sem terminal e sem reiniciar o site.
- Atualização automática configurável em `refreshSeconds` (60 por padrão,
  0 para manual). A interface acompanha dados novos conservando a aba.
- SFTP somente para leitura, com senha ou chave SSH, verificação da identidade
  do servidor e cache incremental das transferências.
- Falha de conexão mantém a última leitura válida daquela origem, se já
  carregada, com aviso. Outra origem não é usada silenciosamente.
- Configurações e chaves ficam fora dos arquivos públicos; dados SFTP de
  autenticação não são devolvidos pela API.

Guia: [COMO-CONFIGURAR.md](COMO-CONFIGURAR.md).
Detalhes e validação: [docs/P3.md](docs/P3.md) e [docs/VALIDACAO-V22.md](docs/VALIDACAO-V22.md).

## Correção da v21.4 — detalhes de Gear e ícones dos trinkets

A v21.3 passou a selecionar corretamente a desconexão mais recente, mas
ainda dependia dos afixos do JSON exportado. O registro mais novo guarda
esses atributos em `vaultGearData`; o leitor de trinkets também omitia o
identificador de serializer presente no formato V0_9. Os dados estavam no
save, mas não eram interpretados pelo site.

- Leitura do Gear compacto da versão enviada: atributos, implicits,
  prefixes, suffixes, nível do item, estado, raridade, reparos e categorias.
- Decimais preservados, inclusive Ability Power e Thorns, e leitura dos
  bônus compostos de habilidades, avoidance, nuvens e melhorias especiais.
- Os trinkets do save são **Carapace (19 usos)** e **Crystal Ball (25 usos)**.
  Nome, função e imagem vêm da identidade nativa de cada item. A configuração
  da instância continua fornecendo os valores dos bônus, quando disponível.
- Charm e necklace também recebem os afixos do registro nativo. O conjunto
  continua vindo de uma única captura; afixos de exports antigos não são
  usados para preencher um logout mais novo.
- Um tooltip por vez e posicionamento abaixo da navegação, inclusive no
  celular. Ability Power roxo e contornos azul/vermelho foram preservados.

Validação: [docs/VALIDACAO-V21.4.md](docs/VALIDACAO-V21.4.md).
Formato e limites: [docs/V21.md](docs/V21.md).

## Correção da v21.3 — companion Legend e deck equipado

- Suporte às famílias **Giant, Eternal, Minion e Antlion** da série Legend.
  Usam modelo de jogador e o perfil de skin salvo no companion, com escala
  correspondente à família. Pets continuam usando os 57 modelos existentes.
- Dados do companion visíveis sob a prévia: tipo/série, nível, vidas, estado,
  habilidade e vaults; botão para abrir seus detalhes. Zero vidas indica
  **Sem vidas**, mesmo quando o prazo de cooldown já terminou.
- Um export antigo de entrada não esconde uma desconexão mais recente.
  Capturas com data são comparadas, preservando todo o conjunto de uma única
  captura. Empates ou datas não comparáveis preservam o export existente.
- **Deck em Gear**: disposição nativa das cartas, slots vazios/Arcane, tier,
  cores, grupos, Foil, efeitos, tarefas e progresso, núcleos e bônus calculados.
  Clique numa carta para ver seus detalhes; o tooltip resume o deck.
- Leitura de `tag.data.cards` e `tag.data.modifiers` do Curios funcional
  `deck`, sem duplicar cartas do inventário interno. Núcleos globais respeitam
  filtros de grupos/cores e a multiplicação nativa; Thorns mantém decimais.
- Campos ausentes permanecem desconhecidos. Efeitos com condições,
  escalonamento, Greed ou núcleo não suportado conservam o valor base e
  indicam que o resultado final não foi calculado.

O novo save foi validado com **M1cstarr, Legend/Giant**, nível 1, zero vidas
de uma e Nova Explosion, além de nove cartas em 11 slots e um Greater
Shiny Core. Esses são os dados da última desconexão enviada; os números
do Papillon da imagem anterior não foram usados para preencher esse save.

Validação: [docs/VALIDACAO-V21.3.md](docs/VALIDACAO-V21.3.md).
Campos e limites: [docs/V21.md](docs/V21.md).

## Complemento da v21.2 — dados completos do companion

- O tooltip do item **Companion em Gear** mostra nível, vidas, cooldown,
  série, tipo, vaults, habilidade temporal e relíquias comuns/Ancient.
  Usa os mesmos dados da aba Companions e do registro de equipamento.
- Leitura de `ancientRelics["0"]`, capacidade Ancient e efeitos combinados
  das relíquias. Efeitos repetidos conservam sua quantidade, indicada por ×2,
  ×3 etc., sem calcular percentuais diferentes dos informados pelo jogo.
- Slots comuns liberados nos níveis **2, 4, 7 e 9** e um slot Ancient no
  **nível 10**, conforme os getters do item no mod.
- Catálogo com 315 definições de modificadores e todas as **15 habilidades
  temporais** do pacote oficial Remastered 2.0.3. Nome, descrição e ícone
  locais; a configuração da instância continua tendo prioridade.
- Para itens nativos identificados, os campos omitidos seguem os defaults
  confirmados no mod: nível/vidas 1 e XP, cooldown e vaults 0. Registros
  incompletos/legados e valores inválidos continuam indicando desconhecido.
- Tooltip fecha com **Esc** e ao tocar fora, inclusive enquanto o mouse
  permanece sobre o cartão.

Validação: [docs/VALIDACAO-V21.2.md](docs/VALIDACAO-V21.2.md).
Fontes e mapeamento: [docs/V21.md](docs/V21.md).

## Correção da v21.1 — companion no Curios head

- Lê o item funcional `the_vault:companion` no slot **head dos Curios**, com
  nome, variante, nível, XP restante, vidas, cooldown, habilidade e relíquias.
  O arquivo geral de companions pode estar vazio ou ausente.
- Usa o mesmo registro de Gear: entrada na vault, última desconexão ou save
  do jogador. O modelo correspondente aparece ao lado do jogador em 3D.
- O slot mostra **Companion** e o nome do companion. Poções continuam com
  seu rótulo próprio; a armadura `HEAD` continua separada do Curios `head`.
- Mantém a coleção legada por proprietário e elimina duplicatas por UUID.
  Os dados do item têm prioridade; informações ausentes permanecem ausentes.
- A aba Companions indica a origem e a data da captura. Em capturas datadas,
  o cooldown é apresentado como estava naquele registro.

Validação: [docs/VALIDACAO-V21.1.md](docs/VALIDACAO-V21.1.md).

## Novidades da v21

- **Gear em 3D**: skin real do jogador, rotação com mouse/toque/setas e botão
  para restaurar a vista. O companion selecionado aparece ao lado, com modelo
  e textura locais extraídos do registro nativo de 57 variantes do mod.
- **Companions**: coleção por proprietário, nível, XP atual/restante, vidas,
  cooldown, habilidade temporal, relíquias e número de vaults. O companion
  equipado é identificado pelo `CompanionUUID` do Curios funcional `head`
  no mesmo registro usado por Gear.
  A seleção visual de outro companion apenas muda a prévia do site.
- **Ranking → XP em uma vault**: um recorde por jogador, usando o maior XP
  gerado em uma única run de todo o histórico. O link abre a vault do recorde,
  inclusive quando ela está em uma página antiga. Empates recebem a mesma posição.
- **XP nas runs**: valores recalculados pela fórmula de `StatCollector`, com
  baús, barris, blocos, mobs, conclusão, bônus e multiplicadores persistidos.
  A configuração `vault_stats.json` da instância tem prioridade; sem ela, são
  usados os defaults confirmados no JAR Remastered 20.0.3. A interface identifica
  o recálculo: alterações históricas da configuração, compartilhamento de XP
  e bônus de Greed podem mudar o XP efetivamente creditado ao jogador.
- **Nível da vault removido das telas de runs**. O nível de progressão do
  jogador permanece no perfil e no ranking por nível.

Os dois saves antigos enviados têm o mapa geral de companions vazio. Esse
arquivo não é mais uma condição para mostrar um companion: a v21.3 também
lê as informações salvas no próprio item equipado no Curios `head`.
Vidas/corações são os registros do companion, não uma medição de HP em tempo
real da entidade. A v21.3 valida o Giant do novo save real e mantém os casos
de teste no formato nativo para outras variantes e estados.

Skins locais têm prioridade; skins online seguem a configuração existente.
Sem textura identificada, o modelo usa uma silhueta neutra claramente indicada.
Sem suporte a WebGL, a prévia de skin comum continua disponível.

Fontes e limites: [docs/V21.md](docs/V21.md).
Validação original da v21: [docs/VALIDACAO-V21.md](docs/VALIDACAO-V21.md).

## Ajustes da v20.2

- Cartões **Chest Breakdown**, **Vault History** e o indicador de nível da
  vault passam a usar os fundos e as bordas do tema do press kit. Rótulos e
  avisos dessas áreas também acompanham a paleta atual.
- Seção **Monstros mais mortos** removida de Statistics.
- Rosto de cada jogador na lista **Players** do detalhe da vault, carregado
  pelo UUID do participante, com o mesmo suporte a skins locais e online do
  restante da Armory.

Validação: [docs/VALIDACAO-V20.2.md](docs/VALIDACAO-V20.2.md).

## Visual da v20.1 — press kit

- Nova paleta de pedra escura, dourado e laranja nas barras de navegação,
  buscas, cartões, estatísticas e coleções da P2.
- Arte oficial **The Vault** na abertura, marca **Vault Hunters** no ranking
  e **Dweller** como fundo discreto do cabeçalho de perfil. As imagens
  fornecidas usam versões próprias para computador e celular.
- Barras de rolagem escuras com marcador dourado na página, abas, histórico,
  lista de jogadores e tooltips; sem a faixa branca dos controles padrão.
- Setas na barra de abas quando há conteúdo fora da tela, mantendo rolagem
  por toque, barra nativa e acesso por teclado. A aba selecionada fica visível.
- Contraste nos painéis, indicação de foco e respeito à redução de movimento.
  Ability Power em roxo, contornos Blue/Red Trinket e cores de raridade mantidos.

Artes e créditos: [public/assets/presskit/README.md](public/assets/presskit/README.md).
Validação: [docs/VALIDACAO-V20.1.md](docs/VALIDACAO-V20.1.md).

## Novidades da v20 — P2

- **Bounties**: filas ativas, disponíveis, prontas para resgate e lendárias,
  com alvo, progresso/meta, Vault XP e itens de recompensa com ícones locais.
- **Quests**: concluídas, prontas para entregar e em andamento, com filtros
  e pesquisa. Metas, nomes e recompensas usam a configuração nativa da instância
  quando disponível; IDs sem definição preservam seu estado e progresso.
- **Discoveries**: modelos, trinkets, artefatos, temas, títulos, emblemas,
  trails e conquistas; coleções por UUID com pesquisa e 24 registros por página.
  Modelos incluem a data nativa de descoberta. Trinkets incluem sua função.
- **PlayerSnapshotDump**: DPS e Defense calculados pelo mod na aba Attributes,
  mais contadores, baús e resultados de objetivos da captura em Statistics.
  A data do snapshot aparece junto desses registros.
- Os históricos de vaults e os ajustes anteriores permanecem disponíveis.

Escopo e fontes: [docs/P2.md](docs/P2.md).
Validação: [docs/VALIDACAO-V20.md](docs/VALIDACAO-V20.md).

## Ajustes da v19.1

- Removidos os quadros **Reputação obtida nas vaults** de Statistics e do
  detalhe das vaults, incluindo essa linha no diagnóstico visual. A reputação
  do perfil continua na seção Vault God Reputation.
- Contorno do ícone de **Blue Trinket** em azul e **Red Trinket** em vermelho,
  inclusive nos tooltips e nos slots repetidos, independentemente da raridade.
- Texto completo de **Ability Power** em roxo nos tooltips de Gear e nos
  atributos do perfil, incluindo seu valor numérico.

Verificação desta revisão: [docs/VALIDACAO-V19.1.md](docs/VALIDACAO-V19.1.md).

## Novidades da v19 — P1

- Aba **Prestige** com poderes aprendidos, rank, bônus, ativação e pontos
  disponíveis/gastos, lidos dos arquivos nativos por UUID.
- Poderes ainda não aprendidos em uma seção expansível, com os requisitos
  de Greed e custos em Knowledge registrados na árvore. Esses valores de compra
  são independentes do progresso do jogador.
- Ilustrações originais do mod para os poderes de Prestige e sua aba.
- **Gold Spent, Barrels, Dungeon Altars e Phoenix Gear Uses** no resumo de
  Statistics e no detalhe de cada vault.
- Diagnóstico expansível com campo, estado, valor e arquivo/caminho de origem.
  Zero registrado aparece como **0**; campo ausente aparece como **—**.
- Totais só são apresentados quando todas as runs decodificadas contêm o campo.
  Se a cobertura for parcial, o diagnóstico mostra o subtotal e quantas runs
  registram esse dado.
- Classes base de mobs dependem de `entity_groups.json`. Sem correspondência
  explícita, ficam Unknown; Champion/Dungeon Boss continuam vindo dos contadores
  nativos. Os tipos individuais de mobs permanecem separados.
- Histórico completo, paginação, XP restante, builds, skins, ícones e os ajustes
  anteriores de Gear/trinkets preservados.

Os dois jogadores do save de nível 70 têm **zero poderes aprendidos de Prestige**
e 34 definições disponíveis na árvore. A interface mostra esse estado. As
situações de poderes aprendidos, tiers de bônus e ativação também foram
conferidas com registros sintéticos no formato nativo confirmado na JAR.

Escopo e fontes: [docs/P1.md](docs/P1.md).
Verificações da entrega: [docs/VALIDACAO-V19.md](docs/VALIDACAO-V19.md).

## Funcionalidades mantidas da v18.2

- **Início** em `/`: top 3 com skin de corpo inteiro, nome e Vault Level abaixo.
  O primeiro lugar fica no centro em desktop; no celular a ordem é 1º, 2º, 3º.
- Ordenação por Vault Level e XP como desempate, usando a mesma API do ranking.
  Nível desconhecido não é confundido com nível zero nem entra no pódio.
- Se houver apenas um ou dois jogadores com nível, aparecem apenas os disponíveis.
- Cards do pódio abrem o perfil. A página inicial também tem busca por nome/UUID
  e cards de todos os jogadores com rostos.
- **Armory** em `/armory`, com skin no cabeçalho do perfil em todas as abas.
  A lista lateral e a classificação completa também mostram o rosto da skin.
- Links antigos `/?player=<UUID>` continuam abrindo o perfil correto.
- Skins locais: um PNG da textura monta automaticamente rosto e corpo, com
  as camadas externas. Falha/ausência de imagem não impede a leitura do mundo.
- Skins online ativadas por padrão, com MCHeads e Crafatar como alternativa.
- Ícones originais do mod em Abilities, especializações, Talents, Expertise,
  Research e nas builds salvas, incluindo o ícone escolhido no Skill Altar.
- Gear com miniaturas nos cards e tooltips, usando o modelo visual do item
  quando disponível. Armaduras e magnets usam os sprites originais; armas,
  escudos e wands também têm miniaturas geradas dos modelos 3D da JAR.
- As imagens do mod acompanham o pacote e são servidas pelo próprio dashboard.
- Gear mostra apenas armaduras, offhand e Curios equipados. A hotbar, a mão
  principal e o conteúdo das mochilas ficam fora dessa tela.
- Disposição com Curios à esquerda, skin no centro e armaduras, poção dos
  Curios e offhand à direita. No celular, a skin fica acima das duas colunas.
- Cada conjunto usa um único registro, com data e momento da captura visíveis.
- Gear: removidas da exibição as linhas Gear Roll Type, Gear Unique Pool,
  Unique Item Key, Gear Model, Gear Name e Exact data source, conforme as
  marcações enviadas. Os afixos continuam disponíveis no tooltip.
- Trinkets mostram nome e ícone do tipo equipado, capacidades e usos restantes
  quando registrados. A identidade vem do atributo nativo do próprio item,
  tanto no JSON exportado quanto nos dados compactados dos saves.
- Removidos os blocos **Item Details**, **Technical** e as notas sobre a origem
  técnica dos dados. Afixos, atributos e reparos continuam no tooltip.

### Efeitos dos trinkets

O dashboard procura `config/the_vault/trinket.json` no mundo e na raiz da
instância/servidor e usa seus nomes e descrições, incluindo os valores dos
bônus definidos nessa instância. Também aceita um caminho explícito em
`VH_TRINKET_CONFIG_PATH`. O botão **Recarregar dados** relê a configuração.

Sem esse arquivo, mostra a função dos trinkets conhecidos do Remastered 20.0.3
em português, sem atribuir porcentagens de outra configuração ao seu jogo.
Trinkets sem identidade legível mostram **Efeito indisponível neste registro**;
itens não identificados mantêm essa condição. Os slots Blue/Red não são usados
para adivinhar o tipo. Os dois saves fornecidos não contêm trinkets equipados;
o formato nativo foi conferido na JAR e validado com registros sintéticos.

Verificações desta entrega: [docs/VALIDACAO-V18.2.md](docs/VALIDACAO-V18.2.md).

## Correções da v18.1

- XP atual, meta, porcentagem e **XP restante para o próximo nível** no cabeçalho
  e no Overview. O leitor agora reconhece `levelMetas[nivel].tnl`, o campo nativo
  da configuração de níveis do Remastered.
- Busca da configuração na pasta do mundo e na raiz da instância/servidor.
  Caminho explícito opcional com `VH_VAULT_LEVELS_PATH`.
- Na ausência da configuração, usa os valores padrão da JAR Remastered 20.0.3
  enviada, com indicação **regra padrão** na tela. Uma configuração inválida
  gera diagnóstico; ela não é silenciosamente substituída pelo padrão.
- Leitura dos slots reais de `the_vault_SkillAltar.dat` na aba Abilities,
  com habilidades, talentos e tiers de bônus separados do perfil atual.
- Correção da falha de leitura provocada pelo tamanho das árvores de builds.
  Os dois jogadores do novo save são carregados sem perder seus perfis.
- Nomes de itens Unique lidos de `clientCache.gearName`; raridade e nome
  do item deixam de depender apenas do modelo visual.

Análise dos novos saves: [docs/ANALISE-NIVEIS-ALTOS-V18.1.md](docs/ANALISE-NIVEIS-ALTOS-V18.1.md).
Verificações da v18.1: [docs/VALIDACAO-V18.1.md](docs/VALIDACAO-V18.1.md).

## P0 preservado da v18

- Histórico completo em memória, sem descartar runs após a 50ª.
- Índice global por jogador, Snapshot ID e Vault ID, reconstruído a cada recarga.
- Cada snapshot referenciada é lida e convertida de NBT uma vez por recarga.
- Uma única varredura do stream encontra os UUIDs dos jogadores identificados
  nos arquivos do mundo. Os offsets são reutilizados para decodificar cada
  StatCollector e validar o Vault Level, sem repetir a busca por jogador.
- Participantes correlacionados na mesma snapshot, incluindo runs antigas.
- Listagem paginada na API e na aba Vaults, com 25 runs por página por padrão.
- Detalhes completos carregados apenas ao selecionar uma run.
- Statistics apresenta totais de todo o histórico e um botão para abri-lo em Vaults.
- Requisições simultâneas compartilham uma carga em andamento. A troca do cache
  só acontece depois que o novo mundo foi completamente processado.

Esta entrega inclui o **P3** de acesso SFTP e cache incremental das transferências,
preservando os **P0/P1/P2** e as correções de Gear, companions e decks da V21.4.

## Executar no Windows

O caminho mais direto é editar `config.json` e abrir `INICIAR-SITE.bat`.
Veja os exemplos de pasta local e servidor em [COMO-CONFIGURAR.md](COMO-CONFIGURAR.md).
O Node.js LTS precisa estar instalado; a primeira execução instala as dependências.
Mantenha a janela do inicializador aberta durante o uso.

### Execução por PowerShell, se preferir

Use Node.js 18 ou superior. Extraia o ZIP e abra a pasta `VHArmory-do-zero-v22`:

```powershell
npm ci
$env:VH_WORLD_PATH="C:\Users\fabio\curseforge\minecraft\Instances\Vault Hunters Third Edition - Remastered\saves\World"
npm start
```

Início: `http://localhost:3000`. Perfis: `http://localhost:3000/armory`.
Ranking: `http://localhost:3000/ranking`.
`VH_PORT` pode alterar a porta. Sem `VH_WORLD_PATH`, o projeto lê `data/world`.
A variável aponta para a **raiz do mundo**, onde ficam `data/`, `playerdata/`
e `stats/`, e não diretamente para a subpasta `data/`.

Para usar arquivos copiados, preserve esta estrutura:

```text
VHArmory-do-zero-v22/
  data/world/
    data/the_vault_*.dat
    data/vault_snapshots/<SnapshotId>.dat
    playerdata/<UUID>.dat
    stats/<UUID>.json
```

O ZIP do projeto não inclui seus saves nem a JAR. Não é necessário executar
Minecraft ou carregar a JAR para usar o dashboard.

`.env.example` documenta os nomes das variáveis; o projeto não carrega `.env`
automaticamente. Defina as variáveis no terminal antes de iniciar.

O botão **Recarregar dados** relê `config.json`, seleciona a origem e reconstrói
o índice a partir dos arquivos atuais. A V22 também faz recargas automáticas
no intervalo escolhido; em SFTP, reaproveita transferências de arquivos estáveis.

## Ícones e imagens dos itens

Os recursos visuais vêm da JAR `the_vault-1.18.2-20.0.3-remastered.6872.jar`
enviada. Os créditos das texturas e modelos permanecem com os autores do mod.
O pacote inclui mais de 3.300 PNGs e um catálogo que relaciona os identificadores dos
saves às imagens. Nenhuma consulta externa é necessária para carregar esses
ícones, e não é necessário instalar Python ou ter a JAR para executar o site.

As especializações mostram seu próprio ícone; na ausência de uma correspondência,
usam o da habilidade principal. Gear prioriza o modelo visual salvo e depois
a imagem base do item. Itens sem visual identificável e imagens que falham
mantêm um ícone reserva, sem impedir o carregamento do perfil.

Quando `tool_type` está disponível nos atributos, inclusive após a leitura
de `vaultGearData`, o item pode selecionar uma das 31 imagens de Tool
incluídas. Um tipo ausente ou não suportado mantém o ícone reserva. As miniaturas
3D usam as texturas e transformações de GUI dos modelos; efeitos de encantamento,
animação, tintas dinâmicas e shaders do jogo não são reproduzidos.

Para regenerar os recursos durante o desenvolvimento, instale Pillow e NumPy
em Python 3 e Java 17 para a extração do P2. Execute na raiz do projeto:

```powershell
python scripts/build-vault-assets.py "C:\caminho\the_vault-1.18.2-20.0.3-remastered.6872.jar"
python scripts/build-p2-data-assets.py "C:\caminho\the_vault-1.18.2-20.0.3-remastered.6872.jar"
```

O script grava PNGs, catálogo e relatório em `public/assets/vault/`. Essa etapa
é opcional: os arquivos gerados já acompanham esta versão.

## Skins locais e online

O pacote carrega **skins online automaticamente**, conforme autorizado, usando
o UUID da conta Minecraft. Os ZIPs de saves enviados não contêm texturas de
skins. Para usar uma skin local, coloque seu PNG original em
`data/skins/<UUID>.png`, com ou sem hífens no UUID. É a textura 64×64 (ou 64×32
legado), não uma captura de tela do personagem. Múltiplos desses tamanhos são
aceitos até 1024 pixels de largura e 2 MiB. A face e o corpo frontal são montados
no navegador, sem uma biblioteca gráfica adicional. Há detecção do formato
slim e uso das camadas externas.

Para apontar a uma pasta existente:

```powershell
$env:VH_SKINS_PATH="C:\caminho\skins"
```

Skins locais sempre têm prioridade. Na ausência de um PNG, o navegador consulta
o **MCHeads** e, em caso de falha, o **Crafatar**, enviando o UUID do jogador.
As URLs usam HTTPS e omitem o cabeçalho de referência da página. O backend do
dashboard não encaminha saves para esses serviços.

Para usar apenas skins locais, desative a consulta antes de iniciar:

```powershell
$env:VH_ONLINE_SKINS="0"
npm start
```

Sem essa variável, ou com `"1"`, a consulta online fica ativa. Com `"0"`, as
imagens ficam restritas ao próprio site e aos renders locais, também por
Content Security Policy. Se nenhuma fonte carregar, aparece uma miniatura de
reserva; no corpo, o aviso **Skin indisponível**. A skin é visual e não muda
atributos ou equipamento.

A skin online é a da conta Minecraft associada ao UUID; servidores offline ou
mods de skins podem usar
uma aparência diferente. Os serviços e o navegador mantêm cache, então uma
troca recente de skin pode demorar a aparecer.

O corpo da skin pode aguardar até 30 segundos por tentativa. O fallback do
Crafatar verifica o status HTTP para evitar mostrar uma imagem genérica de erro
como skin do jogador. O carregamento das imagens não bloqueia o perfil.

Documentação dos serviços: [MCHeads](https://mc-heads.net/) e
[Crafatar](https://crafatar.com/).

Depois de adicionar/trocar um PNG local, use **Recarregar dados**. Isso atualiza
os renders do perfil e das listas.

## Registro do equipamento

A aba Gear representa o equipamento de um registro completo, sem misturar
armaduras e Curios de momentos diferentes. Não lista armas ou ferramentas da
hotbar, itens da mão principal nem conteúdo de inventários de mochilas. Uma
mochila equipada em Curios aparece como item do slot. Equipamentos de outros
mods e armaduras do Minecraft também aparecem se estiverem nesses slots.

**Na JAR enviada, não há garantia de captura ao sair de uma vault.** O arquivo
`playerSnapshots/<UUID>.json` é gravado pelo evento de entrada na vault, e
`the_vault_LogoutSnapshots.dat` registra a desconexão do jogador. Os saves
enviados contêm o segundo tipo. A interface informa o tipo e a data do registro,
em vez de apresentá-lo como equipamento capturado na saída.

Para implementar a captura exclusivamente ao sair, será necessário um gatilho
no mod/servidor que exporte o conjunto nesse momento, com identificação da vault,
do jogador e da captura. Essa integração ainda não acompanha o dashboard.
Ela não pode ser inferida apenas do horário de uma vault concluída ou de um logout.
Detalhes das fontes e da seleção: [docs/GEAR-REGISTROS.md](docs/GEAR-REGISTROS.md).

## Configuração de XP

O arquivo nativo é `config/the_vault/vault_levels.json`, fora da pasta `data/`.
Num mundo local em `<instancia>/saves/<mundo>`, o leitor também procura em
`<instancia>/config/the_vault/`. Num servidor, procura na raiz que contém o mundo.
Se ele estiver em outro local, defina o caminho antes de executar `npm start`:

```powershell
$env:VH_VAULT_LEVELS_PATH="C:\caminho\instancia\config\the_vault\vault_levels.json"
```

A meta se refere ao **nível atual**: `levelMetas[70].tnl` é o requisito para ir
de 70 a 71. O XP restante é `max(0, meta - XP atual)`. O XP já corresponde ao
progresso dentro do nível; `expMultiplier` não multiplica o requisito novamente.

O novo ZIP de dados não contém esse JSON. Para nível 70, o padrão da JAR exige
246.750 XP: com 142.729 XP faltam 104.021, e com 240.797 faltam 5.953. Esses
valores pressupõem a configuração padrão e Greed tier 0. A configuração da sua
instância sempre tem prioridade. Clique em **Recarregar dados** após atualizar
o arquivo para limpar o cache e ler a nova meta.

Para exigir a configuração da instância, sem usar o padrão:

```powershell
$env:VH_USE_JAR_XP_DEFAULTS="0"
```

O fallback padrão cobre os níveis 0–99. A integração completa da progressão
Greed fica pendente; sem seu estado nativo não há garantia para personagens
com Greed. A configuração nativa suporta o cálculo de escalonamento e um
`greedTier` explícito vindo de um runtime snapshot, quando disponível.

Os perfis na API incluem `vault.nextLevel`, `nextLevelXp`, `xpRemaining`,
`xpProgress` (0–1), `xpRequirementSourceKind` e `xpRequirementVerified`.
`jar-default` significa regra padrão, não confirmação da configuração do mundo.
Um XP/meta ausente continua `null` e não vira zero.

## Builds salvas

Abra **Abilities → Builds salvas** e expanda um slot. O save do Skill Altar
persiste habilidades, talentos e ícone. Os rótulos Build 1–5 representam os
slots 0–4; não são nomes personalizados encontrados no arquivo. Slots de
conteúdo igual permanecem separados. Não há marcação confiável de build ativa,
equipamentos ou expertise por slot nesse formato.

## API do histórico

```http
GET /api/players/:uuid/vaults?page=1&limit=25
```

A listagem retorna resumos suficientes para os cards:

```json
{
  "ok": true,
  "uuid": "<UUID>",
  "name": "<nome>",
  "total": 61,
  "totalRuns": 61,
  "page": 1,
  "limit": 25,
  "pages": 3,
  "hasPrevious": false,
  "hasNext": true,
  "runs": []
}
```

No exemplo, `runs` representa os resumos retornados naquela página.
`page` começa em 1; `limit` aceita 1–100. Valores inválidos retornam HTTP 400.
Páginas além do fim retornam `runs: []`; jogador sem runs tem `total: 0` e
`pages: 0`. A ordem é timestamp decrescente, com Snapshot ID como desempate.

```http
GET /api/players/:uuid/vaults/:fileId
```

Retorna `run` com todos os detalhes e participantes. Aceita também Vault ID
para compatibilidade; se houver várias snapshots da Vault, seleciona a mais
recente pertencente ao jogador. Um ID sem run desse jogador retorna HTTP 404.

**Mudança de contrato:** `/api/players/:uuid` e `/api/players/:uuid/diagnostics`
retornam o resumo e agregados do histórico sem a lista `vaultHistory.runs`.
A cópia em `statistics.history` também contém apenas o resumo. Clientes devem
consultar a listagem paginada e o endpoint de detalhe. Não se deve concluir que
há apenas 25 runs a partir do tamanho de uma página; consulte `total`.

## Fontes e integridade

Fontes autoritativas do histórico:

- `data/the_vault_VaultSnapshots.dat`: referências com FileId, VaultId e Timestamp.
- `data/vault_snapshots/<FileId>.dat`: Snapshot e SnapshotKeys.

Referências repetidas do mesmo FileId são processadas uma vez. Arquivos ausentes,
corrompidos e referências conflitantes ficam no diagnóstico. Os agregados incluem
**todas as runs decodificadas**, não apenas a página exibida, e podem representar
um histórico incompleto quando o save não contém todos os arquivos necessários.
Nenhuma run é fabricada para compensar arquivos ausentes.

Participação exige StatCollector válido após um UUID identificado nas fontes do
mundo. O índice não adivinha identidades de UUIDs ausentes dessas fontes.
Vault Level usa a validação da v17. Player Level histórico permanece `null`
quando não persistido; o nível atual não é usado como substituto.

Gear prioriza um registro completo de `playerSnapshots/<UUID>.json`, depois o
último LogoutSnapshots e, na ausência desses, o save do jogador. A seleção
preserva o conjunto inteiro, inclusive slots sem itens. Attributes mantém a
prioridade para o registro JSON, com fallback para playerdata. A configuração
`config/the_vault/entity_groups.json` continua sendo usada para classes de mobs.

## Diagnóstico

```http
GET /api/vault-index-diagnostics
GET /api/players/:uuid/vault-history-diagnostics?page=1&limit=25
GET /api/players/:uuid/gear-diagnostics
GET /api/players/:uuid/attribute-diagnostics
POST /api/reload
```

O diagnóstico global informa referências, duplicatas, arquivos lidos, varreduras,
snapshots com runs, StatCollectors decodificados e falhas. O diagnóstico por jogador
possui paginação dos registros e mantém os totais globais e individuais separados.

## Estrutura

- `config.json`: origem dos dados e execução, editáveis sem terminal.
- `scripts/start.cjs` e `INICIAR-SITE.bat`: inicialização por dois cliques.
- `src/providers/LocalProvider.js`: acesso aos arquivos locais.
- `src/providers/SourceManager.js`: seleção da origem e publicação de capturas.
- `src/providers/SftpSession.js` e `SftpMirror.js`: transporte somente leitura e cache local.
- `src/parsers/vaultSnapshotDecoder.js`: decodificação e construção do índice.
- `src/parsers/vaultHuntersParser.js`: normalização do mundo e perfis.
- `src/parsers/snbt.js`: leitura do NBT textual dos itens do registro JSON.
- `src/api/vaultHistory.js`: paginação e serialização de resumos/detalhes.
- `src/progression/vaultXp.js`: regras nativas e padrão de XP, com proveniência.
- `src/server.js`: API e cache do mundo.
- `public/`: interface.
- `public/skins.js`: textura local, renders frontal/face e fallback online.
- `public/icons.js`: ícones originais e miniaturas dos itens do mod.
- `test/`: regressões do P0, XP, builds, slots de Gear e saves opcionais.

O SFTP sincroniza apenas os arquivos usados pelo dashboard para uma captura local
isolada e reaproveita o parser existente. Transferências estáveis são incrementais;
o índice de jogadores e vaults é reconstruído em memória durante a recarga.
O cache de arquivos persiste em disco; o site precisa restabelecer a conexão SFTP
depois de reiniciar. Essa versão não oferece edição de arquivos do Minecraft.

## Verificação

```powershell
npm test
```

Os testes sintéticos verificam 61 snapshots com dois participantes, acesso à run
mais antiga, leitura única, totais completos, paginação, HTTP 400/404, duplicatas,
arquivos ausentes/corrompidos e cargas simultâneas.

A regressão opcional contra o `data.zip` enviado pode ser executada após extrair
seu conteúdo numa pasta que contenha `data/`:

```powershell
$env:VH_TEST_WORLD_PATH="C:\caminho\fixture-world"
npm test
```

Esse teste confere os valores conhecidos da snapshot
`4e1ca4c5-c8af-493b-8274-c449a5865a8c`: nível 13, 59 baús, 86 mobs, 1 Champion
e 465 Soul Shards.

Para validar também o novo `data(2).zip`, extraia-o em outra pasta e defina:

```powershell
$env:VH_TEST_HIGH_WORLD_PATH="C:\caminho\fixture-niveis-altos"
npm test
```

Com as duas variáveis, passam **54 testes**, incluindo os dois jogadores de
nível 70, cinco builds, a snapshot compartilhada, os companions no formato
nativo, o cálculo de XP por run e o ranking de recordes. Sem os saves de teste,
as regressões que dependem dos arquivos enviados são ignoradas.

O novo grupo confere as rotas Início/Armory/Ranking, desempate por XP, nível zero
versus nível desconhecido, PNG local e a restrição de imagens ao modo configurado.

Notas de versões anteriores, algumas superadas: `docs/HISTORY.md`.
