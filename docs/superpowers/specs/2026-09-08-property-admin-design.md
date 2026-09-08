# Área Administrativa de Imóveis — Especificação de Design

**Data:** 2026-09-08  
**Status:** Aprovada para planejamento da implementação  
**Escopo inicial:** uma conta administrativa para a Tamara

## Objetivo

Permitir que a Tamara faça login em uma área administrativa separada para cadastrar, editar, publicar, arquivar e atualizar imóveis — incluindo preço, características, localização e fotos — sem editar código e sem alterar diretamente a estrutura visual do site público.

## Contexto atual

O site é uma aplicação estática em HTML, CSS e JavaScript. Os imóveis estão atualmente em `imoveis-data.js` como um array `IMOVEIS_DATA`, e as fotos estão em `assets/imoveis`. O site público renderiza os cards e o modal diretamente desse array.

A migração precisa ser gradual: o site público deve continuar funcionando com os dados atuais caso a configuração do banco ainda não esteja disponível ou caso uma requisição falhe.

## Arquitetura escolhida

Usaremos Supabase como camada de backend:

- Supabase Auth para login por e-mail e senha;
- PostgreSQL para os dados dos imóveis;
- Supabase Storage para as fotos;
- RLS (Row Level Security) para separar leitura pública de operações administrativas;
- cliente Supabase com chave publicável no navegador;
- nenhuma chave `service_role` ou segredo de backend no código público.

O painel será uma área separada, inicialmente em `admin.html`, com seus próprios arquivos de estilo e lógica. O site público receberá um adaptador de dados que consulta imóveis publicados no Supabase e usa `IMOVEIS_DATA` como fallback somente quando o Supabase não estiver configurado ou estiver indisponível.

## Fluxo de dados

1. Visitante acessa o site público.
2. O adaptador tenta carregar imóveis publicados no Supabase.
3. Se a configuração estiver ausente ou a consulta falhar, o site usa o array estático atual e registra um aviso não visível ao visitante.
4. Administradora acessa `/admin.html`.
5. Após o login, o painel consulta apenas dados autorizados.
6. A administradora cria ou edita o imóvel e envia as fotos para o bucket protegido.
7. Ao publicar, o imóvel passa a aparecer no site público sem alteração manual de código.

## Modelo de dados

### `properties`

- `id`: UUID primário;
- `legacy_id`: identificador atual do `imoveis-data.js`, único e opcional;
- `title`: título do imóvel;
- `type`: categoria (`Casa`, `Apartamento`, `Cobertura`, `Terreno` ou outra categoria futura);
- `location`: localização exibida;
- `neighborhood`: bairro ou região;
- `price_cents`: preço em centavos, evitando problemas de arredondamento;
- `features`: lista JSON de características, preservando o formato atual;
- `description`: descrição completa;
- `latitude` e `longitude`: coordenadas opcionais para o mapa;
- `map_url`: URL opcional para casos em que a localização seja fornecida por link;
- `status`: `draft`, `published` ou `archived`;
- `created_at` e `updated_at`.

### `property_images`

- `id`: UUID primário;
- `property_id`: referência ao imóvel;
- `storage_path`: caminho do arquivo no bucket;
- `sort_order`: ordem da galeria;
- `alt_text`: texto alternativo opcional;
- `created_at`.

### `admin_users`

- `user_id`: referência a `auth.users`;
- `role`: inicialmente `admin`;
- `created_at`.

A conta inicial será criada manualmente no Supabase Auth e associada a `admin_users`. O painel não terá fluxo público de cadastro de administradores.

## Segurança

- RLS será habilitado em todas as tabelas expostas.
- Visitantes anônimos poderão consultar somente imóveis com `status = 'published'`.
- Visitantes não poderão inserir, atualizar ou excluir imóveis.
- Operações de criação, edição, publicação, arquivamento e exclusão serão permitidas apenas para usuários presentes em `admin_users`.
- Fotos públicas só serão servidas para imóveis publicados; gravação, substituição e exclusão exigirão autenticação administrativa.
- A autorização usará identidade autenticada e dados de aplicação controlados pelo sistema, nunca `user_metadata` editável pelo usuário.
- O cliente público usará somente a chave publicável; a chave de serviço ficará fora do repositório e fora do navegador.
- Políticas de atualização incluirão tanto `USING` quanto `WITH CHECK`.

## Painel administrativo inicial

O MVP terá:

- tela de login;
- proteção de rota para impedir acesso sem sessão;
- listagem de imóveis com filtros por status e categoria;
- formulário de criação e edição;
- campos para preço, título, categoria, localização, características e descrição;
- campos opcionais para latitude, longitude e link do mapa;
- upload múltiplo de fotos com pré-visualização e ordenação;
- ações de salvar rascunho, publicar e arquivar;
- botão de sair;
- mensagens claras de sucesso e erro.

Ficam fora da primeira versão: múltiplos níveis de permissão, histórico de alterações, edição em massa, CRM de leads e sincronização automática com portais imobiliários.

## Migração sem quebra

1. Criar o esquema e as políticas sem alterar a renderização atual.
2. Criar o painel e importar os imóveis existentes usando `legacy_id`.
3. Implementar o adaptador público com fallback para `IMOVEIS_DATA`.
4. Validar que cards, filtros, galerias, modal, compartilhamento e mapa continuam funcionando.
5. Somente após os testes, ativar a consulta remota como fonte principal.
6. Manter o arquivo estático durante uma janela de segurança; ele poderá ser removido apenas depois de confirmar que todos os imóveis e fotos foram migrados.

## Testes e critérios de aceite

- Usuário não autenticado consegue visualizar apenas imóveis publicados.
- Usuário não autenticado não consegue criar, editar, publicar, arquivar ou excluir dados.
- A conta administrativa consegue realizar o fluxo completo de cadastro.
- Upload, ordenação e exclusão de fotos funcionam sem expor chaves secretas.
- O site público continua carregando com o fallback quando o Supabase não estiver configurado.
- Os imóveis importados preservam título, categoria, preço, características, descrição e fotos.
- Filtros, modal, navegação de fotos e compartilhamento continuam operacionais.
- A página não exibe segredos em HTML, JavaScript, logs ou arquivos versionados.
- Testes de RLS comprovam os cenários anônimo, administrador e tentativa de acesso indevido.

## Referências técnicas

- Supabase Auth: https://supabase.com/docs/guides/auth
- Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Storage Access Control: https://supabase.com/docs/guides/storage/security/access-control
- Secure configuration: https://supabase.com/docs/guides/security/product-security
