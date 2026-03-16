import * as net from "net";
import { logger } from "../util/utilities";
import { EventDispatcher, IEvent } from "strongly-typed-events";
import { FrameData, Messages } from "./messageParser";

import * as sm from "../models/solutionModel";

/**
 * Represents a preview server that can send data and update XAML files.
 */
export interface IPreviewServer {
	sendData(data: Buffer): void;
	updateXaml(fileData: sm.File, xamlText: string): void;
}

/**
 * Represents a preview server that can send data and update XAML files.
 */
export class PreviewServer implements IPreviewServer {
	/**
	 * Starts the preview server.
	 */
	public async start() {
		logger.info(`PreviewServer.start ${this._assemblyName}`);

		this._onReady = new EventDispatcher<IPreviewServer, void>();
		this._onError = new EventDispatcher<IPreviewServer, Error>();
		this._onFrame = new EventDispatcher<IPreviewServer, FrameData>();
		this._isReady = false;
		this._dpiX = 96.0;
		this._dpiY = 96.0;
		this._socket = undefined;
		this._socketBuffer = Buffer.alloc(0);

		// Recreate the underlying TCP server so that stop()+start() is idempotent
		// and never accumulates stale "connection" listeners.
		this._server = net.createServer();
		this._server.on("connection", this.handleSocketEvents.bind(this));
		this._server.listen(this._port, this._host, () =>
			logger.info(`Preview server listening on port ${this._port}`)
		);
	}

	handleSocketEvents(socket: net.Socket) {
		logger.info(`Preview server connected on port ${socket.localPort}`);
		this._socket = socket;
		this._socketBuffer = Buffer.alloc(0);

		socket.on("data", (data) => {
			this._socketBuffer = Buffer.concat([this._socketBuffer, data]);
			this._processBuffer(socket);
		});

		socket.on("close", () => {
			logger.info(`Preview server closed for ${this._assemblyName}`);
			this._server.close();
			this._socket?.destroy();
		});

		socket.on("error", (error) => {
			logger.error(`Preview server error: ${error}`);
			logger.show();
		});
	}

	/** Reassemble TCP stream into discrete protocol messages. */
	private _processBuffer(socket: net.Socket) {
		while (this._socketBuffer.length >= 20) {
			const bodyLen = this._socketBuffer.readUInt32LE(0);
			const totalLen = 20 + bodyLen;
			if (this._socketBuffer.length < totalLen) {
				break; // Wait for more data
			}
			const message = this._socketBuffer.subarray(0, totalLen);
			this._socketBuffer = this._socketBuffer.subarray(totalLen);
			this._handleMessage(socket, message);
		}
	}

	private _handleMessage(socket: net.Socket, data: Buffer) {
		this._onMessage.dispatch(this, data);
		const type = data.messageTypeId();

		if (type === Messages.startDesignerSessionMessageId) {
			logger.info("Start designer session message received.");
			socket.write(Messages.clientSupportedPixelFormatsMessage());
			logger.info("Sent client supported pixel formats.");
			// If the webview already told us the device DPI before the socket connected,
			// send it now so the very first frame is rendered at the correct resolution.
			if (this._dpiX !== 96 || this._dpiY !== 96) {
				socket.write(Messages.clientRenderInfoMessage(this._dpiX, this._dpiY));
				logger.info(`Sent deferred client render info (dpiX=${this._dpiX}, dpiY=${this._dpiY})`);
			}
		} else if (type === Messages.frameMessageId) {
			try {
				const doc = data.document();
				const frame = Messages.parseFrameData(doc);
				logger.info(`Frame received: ${frame.width}×${frame.height} seq=${frame.sequenceId}`);
				socket.write(Messages.frameReceivedMessage(frame.sequenceId));
				this._onFrame.dispatch((this as unknown) as IPreviewServer, frame);
			} catch (e: any) {
				logger.error(`Failed to parse frame: ${e.message}`);
			}
		} else if (type === Messages.updateXamlResultMessageId) {
			logger.info("XAML update completed");
			this._isReady = true;
			this._onReady.dispatch((this as unknown) as IPreviewServer);
		} else if (type === Messages.htmlTransportStartedMessageId) {
			logger.info("HTML transport started");
		} else {
			logger.info("msg: " + type);
		}
	}

	/**
	 * Stops the preview server.
	 */
	public stop() {
		logger.info(`PreviewServer.stop ${this._assemblyName}`);
		this._server.close();
	}

	/**
	 * Gets whether the preview server is running.
	 */
	public get isRunning() {
		return this._server?.listening;
	}

	public get isReady() {
		return this._isReady;
	}

	/**
	 * Sends a ClientRenderInfoMessage to the previewer, requesting a re-render at the given DPI.
	 * If the socket is not yet open, the values are stored and sent when the session starts.
	 */
	public sendClientRenderInfo(dpiX: number, dpiY: number) {
		this._dpiX = dpiX;
		this._dpiY = dpiY;
		if (this._socket && !this._socket.destroyed) {
			this._socket.write(Messages.clientRenderInfoMessage(dpiX, dpiY));
			logger.info(`Sent client render info (dpiX=${dpiX}, dpiY=${dpiY})`);
		}
	}

	/**
	 * Gets an instance of the preview server for the specified assembly name and port.
	 * @param assemblyName The name of the assembly.
	 * @param port The port to use for the preview server.
	 */
	public static getInstance(assemblyName: string, port: number): PreviewServer {
		let instance = PreviewServer.getInstanceByAssemblyName(assemblyName);
		if (instance) {
			// If the port is different, stop and replace the instance
			if ((instance as any)._port !== port) {
				instance.stop();
				PreviewServer._servers.delete(assemblyName);
				instance = undefined;
			} else {
				return instance;
			}
		}
		const newInstance = new PreviewServer(assemblyName, port);
		PreviewServer._servers.set(assemblyName, newInstance);
		return newInstance;
	}

	/**
	 * Gets an instance of the preview server for the specified assembly name
	 * @param assemblyName The name of the assembly.
	 */
	public static getInstanceByAssemblyName(assemblyName: string): PreviewServer | undefined {
		var instance = PreviewServer._servers.get(assemblyName);
		return instance;
	}

	private constructor(private _assemblyName: string, private _port: number) {
		this._server = net.createServer();
	}

	updateXaml(fileData: sm.File, xamlText: string): void {
		this._isReady = false;
		const updateXamlMessage = Messages.updateXaml(fileData.targetPath, xamlText);
		this._socket?.write(updateXamlMessage);
	}

	sendData(_data: Buffer): void {
		logger.info("In PreviewServer.sendData");
	}

	public get onMessage(): IEvent<IPreviewServer, Buffer> {
		return this._onMessage.asEvent();
	}

	public get onFrame(): IEvent<IPreviewServer, FrameData> {
		return this._onFrame.asEvent();
	}

	_onMessage = new EventDispatcher<IPreviewServer, Buffer>();
	_onReady = new EventDispatcher<IPreviewServer, void>();
	_onError = new EventDispatcher<IPreviewServer, Error>();
	_onFrame = new EventDispatcher<IPreviewServer, FrameData>();

	public get onReady(): IEvent<IPreviewServer, void> {
		return this._onReady.asEvent();
	}

	public get onError(): IEvent<IPreviewServer, Error> {
		return this._onError.asEvent();
	}

	dispatchError(signal: string) {
		this._onError.dispatch(this, new Error(`Preview server error: ${signal}`));
	}

	_server: net.Server;
	_socket: net.Socket | undefined;
	_socketBuffer: Buffer = Buffer.alloc(0);
	_host = "127.0.0.1";
	private _isReady = false;
	private _dpiX = 96.0;
	private _dpiY = 96.0;

	private static _servers = new Map<string, PreviewServer>();
}
