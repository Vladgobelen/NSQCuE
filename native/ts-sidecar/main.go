package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/things-go/go-socks5"
	"tailscale.com/tsnet"
)

func main() {
	srv := &tsnet.Server{
		Hostname: "nsqcue-sidecar",
		AuthKey:  os.Getenv("TS_AUTHKEY"),
		Dir:      "./tsnet-state",
	}
	defer srv.Close()

	if _, err := srv.Up(context.Background()); err != nil {
		log.Fatalf("tsnet up failed: %v", err)
	}
	log.Println("Tailscale node is up")

	opts := []socks5.Option{
		socks5.WithDial(func(ctx context.Context, network, addr string) (net.Conn, error) {
			return srv.Dial(ctx, network, addr)
		}),
	}

	server := socks5.NewServer(opts...)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("listen failed: %v", err)
	}
	defer ln.Close()

	fmt.Printf("SOCKS_PORT=%d\n", ln.Addr().(*net.TCPAddr).Port)
	os.Stdout.Sync()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		ln.Close()
	}()

	log.Println("SOCKS5 proxy started")
	if err := server.Serve(ln); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
