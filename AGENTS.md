# Cartas na Mesa

Jogo de cartas. Repositório recém-iniciado: ainda **sem código e sem stack definida**.

## Estado atual

- Nenhuma implementação.
- Stack, engine e formato (web, desktop, mobile) ainda não escolhidos.
- Arquitetura e regras do jogo a definir.

## Time de agentes

O agente padrão é o `orchestrator`, que decompõe o pedido e delega. Os especialistas também podem ser selecionados manualmente com `/agents`.

| Agente | Papel | Pode editar |
| --- | --- | --- |
| `orchestrator` | Planeja, delega, integra e reporta | Nada |
| `architect` | Domínio, stack, contratos e ADRs | `docs/architecture/**`, `docs/adr/**` |
| `researcher` | Investigação de código, libs e referências | Nada |
| `implementer` | Código de produção | Código do projeto |
| `designer` | UX/UI, layout da mesa, acessibilidade | UI, assets e `docs/design/**` |
| `tester` | Testes e reprodução de bugs | Apenas arquivos de teste |
| `reviewer` | Revisão independente | Nada |
| `security` | Auditoria de segurança | Nada |
| `documenter` | README, regras, guias e ADRs | Markdown e `docs/**` |

Fluxo recomendado: `researcher`/`architect` → `implementer` → `tester` + `reviewer` + `security` → `documenter`.

## Convenções

- Código e identificadores em inglês; documentação e comunicação em pt-BR.
- Mudanças pequenas e focadas; sem reformatar arquivos não relacionados.
- Nada de commit ou push sem pedido explícito do usuário.
- Nunca commitar segredos, chaves ou dados reais.
- Testes determinísticos: qualquer aleatoriedade do jogo deve aceitar seed.
- Regras do jogo ficam no domínio, separadas de UI, persistência e rede.
- Acessibilidade não é opcional: cor nunca é o único indicador de estado.

## Comandos

> Definir quando a stack for escolhida.

```bash
# instalar dependências
# rodar em desenvolvimento
# rodar testes
# lint / typecheck
```
