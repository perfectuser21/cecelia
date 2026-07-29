import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

const worker = new Worker();
export default worker;

// ============================================================
// Acceptance Worker（刀2）— 真连 Brain，不再内嵌演示数据
// 拉：GET  /acceptance/pending   （验收单+验收项，Brain SSOT）
// 写：POST /acceptance/results   （员工在 Notion「结果」列填的判定，回写 Brain）
// Brain 是唯一 SSOT；本 Worker 只做搬运 + 呈现，不做业务判定
// ============================================================

const BRAIN_URL = process.env.BRAIN_ACCEPTANCE_URL ?? "";
const BRAIN_TOKEN = process.env.BRAIN_ACCEPTANCE_TOKEN ?? "";
// 验收项库的 data source id：首次部署后从 `ntn api /v1/search` 拿到，回填这个 env（见 README 接线步骤）
const CHECKS_DATA_SOURCE_ID = process.env.ACCEPTANCE_CHECKS_DATA_SOURCE_ID ?? "";

type BrainCheck = {
	check_key: string;
	kind: "FR" | "NFR" | "Invariant" | "SOP";
	name: string;
	device: string | null;
	result: "通过" | "不通过" | "无法验证" | null;
	note: string | null;
};

type BrainRun = {
	run_key: string;
	title: string;
	gp_id: string | null;
	line: string | null;
	surface: string | null;
	version: string | null;
	status: "pending" | "in_review" | "passed" | "failed";
	pass_rate: string | number | null;
	checks: BrainCheck[];
};

const brainApi = worker.pacer("brainApi", { allowedRequests: 10, intervalMs: 10_000 });

async function fetchPendingRuns(): Promise<BrainRun[]> {
	if (!BRAIN_URL || !BRAIN_TOKEN) {
		throw new Error("BRAIN_ACCEPTANCE_URL / BRAIN_ACCEPTANCE_TOKEN 未配置（ntn workers env set）");
	}
	await brainApi.wait();
	const res = await fetch(`${BRAIN_URL}/acceptance/pending`, {
		headers: { Authorization: `Bearer ${BRAIN_TOKEN}` },
	});
	if (!res.ok) throw new Error(`Brain /acceptance/pending 失败: ${res.status}`);
	const data = (await res.json()) as { runs: BrainRun[] };
	return data.runs;
}

async function postResults(results: Array<{ check_key: string; result: string; note?: string }>) {
	await brainApi.wait();
	const res = await fetch(`${BRAIN_URL}/acceptance/results`, {
		method: "POST",
		headers: { Authorization: `Bearer ${BRAIN_TOKEN}`, "Content-Type": "application/json" },
		body: JSON.stringify({ results }),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`Brain /acceptance/results 失败: ${res.status} ${body}`);
	}
	return (await res.json()) as { updated: number };
}

// -- 托管库 1：验收单（锁定列，员工不可改；status/kind 是 Brain 的 CHECK 约束枚举，其余开放字段用 richText） --
const runs = worker.database("acceptanceRuns", {
	type: "managed",
	initialTitle: "验收单（Brain 同步）",
	primaryKeyProperty: "Run Key",
	schema: {
		properties: {
			"验收单": Schema.title(),
			"Run Key": Schema.richText(),
			"GP ID": Schema.richText(),
			"Line": Schema.richText(),
			"Surface": Schema.richText(),
			"版本": Schema.richText(),
			"通过率": Schema.number("percent"),
			"状态": Schema.select([
				{ name: "pending", color: "gray" },
				{ name: "in_review", color: "yellow" },
				{ name: "passed", color: "green" },
				{ name: "failed", color: "red" },
			]),
		},
	},
});

// -- 托管库 2：验收项（锁定列 = 验收内容；「结果/备注」是员工可编辑的原生列，不在此声明） --
const checks = worker.database("acceptanceChecks", {
	type: "managed",
	initialTitle: "验收项（Brain 同步）",
	primaryKeyProperty: "Check Key",
	schema: {
		properties: {
			"验收项": Schema.title(),
			"Check Key": Schema.richText(),
			"类别": Schema.select([
				{ name: "FR", color: "blue" },
				{ name: "NFR", color: "orange" },
				{ name: "Invariant", color: "red" },
				{ name: "SOP", color: "gray" },
			]),
			"设备": Schema.richText(),
			"验收单": Schema.relation("acceptanceRuns"),
		},
	},
});

function runProperties(r: BrainRun) {
	return {
		"验收单": Builder.title(r.title),
		"Run Key": Builder.richText(r.run_key),
		"GP ID": Builder.richText(r.gp_id ?? ""),
		"Line": Builder.richText(r.line ?? ""),
		"Surface": Builder.richText(r.surface ?? ""),
		"版本": Builder.richText(r.version ?? ""),
		"通过率": Builder.number(r.pass_rate != null ? Number(r.pass_rate) : 0),
		"状态": Builder.select(r.status),
	};
}

function checkProperties(c: BrainCheck, runKey: string) {
	return {
		"验收项": Builder.title(c.name),
		"Check Key": Builder.richText(c.check_key),
		"类别": Builder.select(c.kind),
		"设备": Builder.richText(c.device ?? ""),
		"验收单": [Builder.relation(runKey)],
	};
}

// -- Sync 1：验收单。incremental：只推当前 pending/in_review 的单，
//    不做 mark-and-sweep 删除——一旦转 passed/failed 会从 Brain /pending 消失，
//    但 Notion 里已同步的历史记录必须永久保留（用户明确要求"永久查看历史"）。
worker.sync("runsSync", {
	database: runs,
	mode: "incremental",
	schedule: "15m",
	execute: async () => {
		const pending = await fetchPendingRuns();
		return {
			changes: pending.map((r) => ({
				type: "upsert" as const,
				key: r.run_key,
				properties: runProperties(r),
			})),
			hasMore: false,
		};
	},
});

// -- Sync 2：验收项。同理 incremental，不删历史。
worker.sync("checksSync", {
	database: checks,
	mode: "incremental",
	schedule: "15m",
	execute: async () => {
		const pending = await fetchPendingRuns();
		return {
			changes: pending.flatMap((r) => r.checks.map((c) => ({
				type: "upsert" as const,
				key: c.check_key,
				properties: checkProperties(c, r.run_key),
			}))),
			hasMore: false,
		};
	},
});

// -- Sync 3：结果回写 + 快速刷新。每 5 分钟：
//    1) 读 Notion 验收项库里员工已填的「结果」原生列（context.notion，需配 NOTION_API_TOKEN）
//    2) 推给 Brain /acceptance/results（Brain 算好 pass_rate/status 落库，唯一计算点）
//    3) 立刻重新拉 /pending，把 Brain 刚算出的最新状态写回「验收单」锁定列（比等 15 分钟的 runsSync 快）
//    目标库挂 runs：这一步落点是刷新验收单状态，员工填的「结果」列本身不需要这个 sync 回写。
worker.sync("resultsSync", {
	database: runs,
	mode: "incremental",
	schedule: "5m",
	execute: async (_state, { notion }) => {
		if (!CHECKS_DATA_SOURCE_ID) {
			throw new Error("ACCEPTANCE_CHECKS_DATA_SOURCE_ID 未配置");
		}

		const filled = await notion.dataSources.query({
			data_source_id: CHECKS_DATA_SOURCE_ID,
			filter: { property: "结果", select: { is_not_empty: true } },
			page_size: 100,
		});

		const results: Array<{ check_key: string; result: string; note?: string }> = [];
		for (const page of filled.results as Array<{ properties: Record<string, any> }>) {
			const checkKey = (page.properties["Check Key"]?.rich_text ?? [])
				.map((t: { plain_text: string }) => t.plain_text)
				.join("") as string;
			const result = page.properties["结果"]?.select?.name as string | undefined;
			const noteRich = page.properties["备注"]?.rich_text as Array<{ plain_text: string }> | undefined;
			const note = noteRich?.map((t) => t.plain_text).join("") || undefined;
			if (!checkKey || !result) continue;
			results.push(note ? { check_key: checkKey, result, note } : { check_key: checkKey, result });
		}

		if (results.length > 0) {
			await postResults(results);
		}

		const pending = await fetchPendingRuns();
		return {
			changes: pending.map((r) => ({
				type: "upsert" as const,
				key: r.run_key,
				properties: runProperties(r),
			})),
			hasMore: false,
		};
	},
});
