import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { PermissionRequest } from "@/lib/permissions";

const REQUEST_EVENT = "permission_request";
const RESOLVED_EVENT = "permission_resolved";

export function usePermissions(): PermissionRequest[] {
	const [requests, setRequests] = useState<PermissionRequest[]>([]);

	useEffect(() => {
		invoke<PermissionRequest[]>("pending_permissions")
			.then(setRequests)
			.catch(() => {});

		const unlistenRequest = listen<PermissionRequest>(
			REQUEST_EVENT,
			(event) => {
				setRequests((previous) => [
					...previous.filter(
						(request) => request.request_id !== event.payload.request_id,
					),
					event.payload,
				]);
			},
		);
		const unlistenResolved = listen<string>(RESOLVED_EVENT, (event) => {
			setRequests((previous) =>
				previous.filter((request) => request.request_id !== event.payload),
			);
		});

		return () => {
			unlistenRequest.then((dispose) => dispose());
			unlistenResolved.then((dispose) => dispose());
		};
	}, []);

	return requests;
}
