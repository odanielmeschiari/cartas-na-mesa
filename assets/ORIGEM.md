# Origem e licença dos assets

Regra 7 do `AGENTS.md`: todo asset precisa de origem e permissão registradas. Uma linha por
arquivo.

| Arquivo | O que é | Origem | Licença / permissão | Uso previsto |
| --- | --- | --- | --- | --- |
| `ui/banners/copas.jpeg` | Banner "HEARTS" (2048×2048 JPEG): Q♠, K♥ e A♥ sobre feltro verde, com o título dourado | Imagem gerada por IA (Gemini) e enviada pelo autor do projeto em 2026-11-13 | **A confirmar pelo autor:** termos de uso da ferramenta que gerou a imagem para uso comercial/público. O autor enviou o arquivo para este projeto | Capa do Copas no catálogo de jogos, quando o Copas for disponibilizado (passo 6 do item 15a de `next_tasks.md`) |

## Observações

- O título do banner está em inglês ("HEARTS"), enquanto a interface é em pt-BR. Se o catálogo
  precisar do nome em português, será preciso uma versão "COPAS" do banner.
- O arquivo está guardado como recebido, sem recompressão. Antes de servi-lo no cliente, gerar uma
  versão menor (por exemplo, 1024×1024) para não pesar no carregamento no celular.
- O banner ainda **não é referenciado por nenhum código**: fica salvo em `assets/` até o Copas
  entrar no catálogo.
