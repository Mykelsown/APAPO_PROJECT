.PHONY: run test demo up
run:   ## start the API in mock mode, no database needed
	cd backend && DEV_OTP=123456 go run ./cmd/api
test:  ## all tests (set TEST_DATABASE_URL to include Postgres)
	cd backend && go vet ./... && go test -count=1 -p 1 ./...
demo:  ## walk the demo against a running server (make run first)
	scripts/demo.sh http://localhost:8080
up:    ## API plus Postgres in Docker
	docker compose up --build
