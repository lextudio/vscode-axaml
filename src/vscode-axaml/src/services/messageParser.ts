import { BSON } from "bson";

/** Pixel format values as sent in FrameMessage.format (matches Avalonia.Remote.Protocol.Viewport.PixelFormat). */
export const enum PixelFormat {
	Rgba8888 = 1,
	Bgra8888 = 2,
}

export interface FrameData {
	sequenceId: number;
	format: number;
	width: number;
	height: number;
	stride: number;
	dpiX: number;
	dpiY: number;
	data: Buffer;
}

export class Messages {
	public static startDesignerSessionMessageId = "854887CF26944EB6B4997461B6FB96C7";
	public static clientRenderInfoMessageId = "7A3C25D33652438D8EF186E942CC96C0";
	public static clientSupportedPixelFormatsMessageId = "63481025701643FEBADCF2FD0F88609E";
	public static updateXamlMessageId = "9AEC9A2E63154066B4BAE9A9EFD0F8CC";
	public static updateXamlResultMessageId = "B7A700930C5D47FD926122086D43A2E2";
	public static htmlTransportStartedMessageId = "5377800478FA43818EC3176A6F2328B6";
	public static frameMessageId = "F58313EEFE694536819DF52EDF201A0E";
	public static frameReceivedMessageId = "68014F8A289D48518D345367EDA7F827";

	public static parseIncomingMessage(message: Buffer) {
		const length = message.messageSize();
		const type = message.messageTypeId();
		const msg = message.document();

		return { type: type, message: msg, length: length };
	}

	public static clientRenderInfoMessage(dpiX: number = 96.0, dpiY: number = 96.0): Buffer {
		const message = { dpiX, dpiY };
		return createMessage(message, Messages.clientRenderInfoMessageId);
	}

	public static clientSupportedPixelFormatsMessage(): Buffer {
		const message = { formats: [1, 2] };
		return createMessage(message, Messages.clientSupportedPixelFormatsMessageId);
	}

	public static frameReceivedMessage(sequenceId: number): Buffer {
		const message = { sequenceId: BSON.Long.fromNumber(sequenceId) };
		return createMessage(message, Messages.frameReceivedMessageId);
	}

	public static updateXaml(assemblyPath: string, xamlText: string): Buffer {
		const message = {
			assemblyPath: assemblyPath,
			xaml: xamlText,
		};
		return createMessage(message, Messages.updateXamlMessageId);
	}

	/**
	 * Parses a FrameMessage BSON document into a FrameData object.
	 * Converts Bgra8888 pixel data to RGBA for use with Canvas ImageData.
	 */
	public static parseFrameData(doc: BSON.Document): FrameData {
		const sequenceId: number = typeof doc.sequenceId === "object"
			? (doc.sequenceId as BSON.Long).toNumber()
			: Number(doc.sequenceId);
		const format: number = doc.format;
		const width: number = doc.width;
		const height: number = doc.height;
		const stride: number = doc.stride;
		const dpiX: number = doc.dpiX;
		const dpiY: number = doc.dpiY;
		// BSON Binary — extract raw bytes
		const binary: BSON.Binary = doc.data;
		const raw = Buffer.from(binary.buffer);
		return { sequenceId, format, width, height, stride, dpiX, dpiY, data: raw };
	}

	/**
	 * Converts raw pixel data to RGBA format expected by Canvas ImageData.
	 * Bgra8888 (format=2) needs B↔R swap; Rgba8888 (format=1) is already correct.
	 */
	public static toRgba(frame: FrameData): ArrayBuffer {
		const { width, height, data, format } = frame;
		const pixelCount = width * height;
		const out = new Uint8ClampedArray(pixelCount * 4);
		if (format === PixelFormat.Bgra8888) {
			for (let i = 0; i < pixelCount * 4; i += 4) {
				out[i]     = data[i + 2]; // R ← B
				out[i + 1] = data[i + 1]; // G ← G
				out[i + 2] = data[i];     // B ← R
				out[i + 3] = data[i + 3]; // A ← A
			}
		} else {
			// Rgba8888 or unknown — copy as-is
			for (let i = 0; i < pixelCount * 4; i++) {
				out[i] = data[i];
			}
		}
		return out.buffer;
	}
}

function createMessage(message: any, messageType: string) {
	const bson = BSON.serialize(message);
	const dataLength = bson.length; // 20 is the length of the header
	const total = getLengthBytes(dataLength) + getByString(typeInfo(messageType)) + getByString(bson);
	const messageBytes = Buffer.from(total, "hex");
	return messageBytes;
}

function getLengthBytes(length: number) {
	const hexDataLength = Buffer.alloc(4);
	hexDataLength.writeUInt32LE(length, 0);
	return hexDataLength.toString("hex").toUpperCase();
}

function getByString(byteArray: any) {
	return byteArray.toString("hex").toUpperCase();
}

export function readBuffer(buffer: Buffer) {
	const data = buffer.slice(20);
	try {
		const bson = BSON.deserialize(data);
		return bson;
	} catch (error: any) {
		console.error(error.message);
		return "error";
	}
}

export function typeInfo(guid: string) {
	const guidBytes = Buffer.from(guid, "hex");
	return adjustGuidBytes(guidBytes);
}

export function adjustGuidBytes(byteArray: Buffer) {
	byteArray.slice(0, 4).reverse();
	byteArray.slice(4, 6).reverse();
	byteArray.slice(6, 8).reverse();

	return byteArray;
}

declare global {
	interface Buffer {
		messageSize(): number;
		messageTypeId(): string;
		document(): BSON.Document;
	}
}

Buffer.prototype.messageSize = function (this: Buffer): number {
	return this.readInt32LE(0);
};

Buffer.prototype.messageTypeId = function (this: Buffer): string {
	const typeBytes = this.slice(4, 20);
	const typeInfo = adjustGuidBytes(typeBytes);
	return typeInfo.toString("hex").toUpperCase();
};

Buffer.prototype.document = function (this: Buffer): BSON.Document {
	try {
		const data = this.slice(20);
		const bson = BSON.deserialize(data);
		return bson;
	} catch (error: any) {
		console.error(error.message);
		throw error;
	}
};
