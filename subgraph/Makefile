.PHONY: fork-up fork-down fork-reset fork-status

fork-up:
	bash local/fork-up.sh

fork-down:
	bash local/fork-down.sh

fork-reset: fork-down fork-up

fork-status:
	@curl -s http://localhost:8000/subgraphs/name/sluice/aqua-local -H 'content-type: application/json' \
	  -d '{"query":"{ _meta { block { number } hasIndexingErrors } aquaProtocols { strategyCount liveStrategyCount fillCount } }"}' | jq .
