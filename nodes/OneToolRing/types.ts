import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

/**
 * One resource of the 1ToolRing node. Each resource lives in
 * nodes/OneToolRing/resources/<value>/index.ts and exports a `ResourceModule`.
 */
export interface ResourceModule {
	/** Internal value, e.g. 'tool'. */
	value: string;
	/** Display name in the Resource dropdown (Title Case). */
	name: string;
	description: string;
	/** Every field of this resource. The first entry is the Operation dropdown. */
	properties: INodeProperties[];
	/** Runs one input item. Return one object or an array of objects (one output item each). */
	execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]>;
}
