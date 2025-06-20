import { genDifyRequest } from "@/app/api/utils";
import { NextRequest, NextResponse } from "next/server";

const POST = async (
	_request: NextRequest,
	{ params }: { params: Promise<{ appId: string }> },
) => {
	const { appId } = await params;
	const user = _request.headers.get("dc-user") as string;
	if (!user) {
		return NextResponse.json({
			code: 401,
			message:
				'Unauthorized: lack of user. Please provide the "dc-user" header in your request.',
		});
	}
	const difyRequest = await genDifyRequest(appId);
	const result = await difyRequest.post(`/files/upload`, {
		user,
	});
	return NextResponse.json({
		code: 200,
		data: result,
	});
};

export { POST };
