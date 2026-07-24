import { ActivityState } from '../types/ActivityState';

export const SERVER_ANCHORED_EVENTS = new Set([
	'student_registered',
	'student_session_started',
	'task_started',
	'task_finished',
	'active_editor_changed',
	'submission_exported'
]);

export const HEARTBEAT_ANCHOR_WINDOW = 30;

export function shouldAnchorInRepository(
	eventName: string,
	state: ActivityState,
	random = Math.random
): boolean {
	if (SERVER_ANCHORED_EVENTS.has(eventName)) {
		return true;
	}
	if (eventName !== 'heartbeat') {
		return false;
	}
	const current = state.eventServerHeartbeatSampling;
	const sampling = current?.windowSize === HEARTBEAT_ANCHOR_WINDOW
		? current
		: {
			windowSize: HEARTBEAT_ANCHOR_WINDOW,
			countInWindow: 0,
			anchorAt: randomHeartbeatAnchorPosition(random)
		};
	const nextCount = sampling.countInWindow + 1;
	const shouldAnchor = nextCount === sampling.anchorAt;
	state.eventServerHeartbeatSampling = nextCount >= HEARTBEAT_ANCHOR_WINDOW
		? {
			windowSize: HEARTBEAT_ANCHOR_WINDOW,
			countInWindow: 0,
			anchorAt: randomHeartbeatAnchorPosition(random)
		}
		: {
			...sampling,
			countInWindow: nextCount
		};
	return shouldAnchor;
}

function randomHeartbeatAnchorPosition(random: () => number): number {
	return Math.floor(random() * HEARTBEAT_ANCHOR_WINDOW) + 1;
}
