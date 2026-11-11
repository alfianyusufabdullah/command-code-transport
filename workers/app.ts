import { createRequestHandler } from "react-router";

import { TransportDurableObject } from "./durable";

export { TransportDurableObject };

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === "/ws" || url.pathname === "/agent") {
			const id = env.TRANSPORT.idFromName("global");
			return env.TRANSPORT.get(id).fetch(request);
		}
		return requestHandler(request);
	},
} satisfies ExportedHandler<Env>;
