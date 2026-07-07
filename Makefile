COOK := ./skills/cook/scripts/cook.sh
BATS := bats
JOBS := $(shell getconf _NPROCESSORS_ONLN)

.PHONY: validate doctor init ls status help test release-check

help:
	@echo "make validate  - check .jeff state against the invariants"
	@echo "make doctor    - check the environment (jq, git hook status)"
	@echo "make init      - scaffold and activate jeff in this repo"
	@echo "make ls        - list tasks"
	@echo "make status    - in-flight tasks + backlog health"
	@echo "make test      - run the bats test suite"

test:
	@$(BATS) --jobs $(JOBS) tests/convergence.bats tests/lite.bats tests/profile.bats tests/lite-adopt.bats tests/release-check.bats tests/lite-pipeline.bats tests/backlog.bats tests/gh-issues.bats tests/complexity.bats tests/command-routing.bats tests/cli-location.bats tests/brains.bats tests/verify.bats tests/gate.bats tests/disposition.bats tests/validate-scale.bats tests/payload-hygiene.bats tests/plugin-manifest.bats tests/strict-args.bats tests/precommit-gate.bats tests/prune.bats tests/flavor.bats tests/security-scanner.bats

validate:
	@$(COOK) validate

doctor:
	@$(COOK) doctor

init:
	@$(COOK) init

ls:
	@$(COOK) ls

status:
	@$(COOK) status

release-check:
	@./scripts/release-check
