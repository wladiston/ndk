import NDK, {  NDKPrivateKeySigner, NDKSigner, NDKUser, NostrEvent } from "../../index.js";
import { NDKNostrRpc, NDKRpcResponse } from "./rpc.js";

/**
 * This NDKSigner implements NIP-46, which allows remote signing of events.
 * This class is meant to be used client-side, paired with the NDKNip46Backend or a NIP-46 backend (like Nostr-Connect)
 */
export class NDKNip46Signer implements NDKSigner {
    private ndk: NDK;
    public remotePubkey: string;
    public localSigner: NDKSigner;
    private rpc: NDKNostrRpc;
    private debug: debug.Debugger;

    /**
     *
     * @param ndk - The NDK instance to use
     * @param remotePubkey - The public key of the npub that wants to be published as
     * @param localSigner - The signer that will be used to request events to be signed
     */
    public constructor(ndk: NDK, remotePubkey: string, localSigner?: NDKSigner) {
        this.ndk = ndk;
        this.remotePubkey = remotePubkey;
        this.debug = ndk.debug.extend('nip46:signer');

        if (!localSigner) {
            this.localSigner = NDKPrivateKeySigner.generate();
        } else {
            this.localSigner = localSigner;
        }

        this.rpc = new NDKNostrRpc(ndk, this.localSigner, this.debug);
    }

    public async user(): Promise<NDKUser> {
        return this.localSigner.user();
    }

    public async blockUntilReady(): Promise<NDKUser> {
        const localUser = await this.localSigner.user();
        const user = await this.ndk.getUser({ npub: localUser.npub });
        const connectId = Math.random().toString(36).substring(7);

        // Generates subscription, single subscription for the lifetime of our connection
        this.rpc.subscribe({
            kinds: [24133],
            '#p': [localUser.hexpubkey()],
        });

        const promise: Promise<NDKUser> = new Promise((resolve, reject) => {
            // Subscribe to response of this connection request
            this.rpc.once(`response-${connectId}`, async (response: NDKRpcResponse) => {
                if (response.result === 'ack') {
                    resolve(user);
                } else {
                    reject(response.error);
                }
            });
        });

        await this.rpc.sendRequest(this.remotePubkey, 'connect', [localUser.hexpubkey()], connectId);

        return promise;
    }

    public async encrypt(recipient: NDKUser, value: string): Promise<string> {
        throw new Error('not implemented');
    }

    public async decrypt(sender: NDKUser, value: string): Promise<string> {
        throw new Error('not implemented');
    }

    public async sign(event: NostrEvent): Promise<string> {
        const connectId = Math.random().toString(36).substring(7);

        this.debug('asking for a signature');

        const promise = new Promise<string>((resolve, reject) => {
            this.rpc.once(`response-${connectId}`, async (response: NDKRpcResponse) => {
                this.debug('got a response', response);
                if (!response.error) {
                    const json = JSON.parse(response.result);
                    resolve(json.sig);
                } else {
                    reject(response.error);
                }
            });
        });

        await this.rpc.sendRequest(this.remotePubkey, 'sign_event', [JSON.stringify(event)], connectId);

        return promise;
    }
}
