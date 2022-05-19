/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Plan, ProblemInfo, DomainInfo, parser, planner } from 'pddl-workspace';
import { PlannerService } from './PlannerService';

const HOUR = "HOUR";
const DEFAULT_PLAN_TIME_UNIT_HOUR = HOUR;

/** Wraps the `/request` planning web service interface. */
export class PlannerAsyncService extends PlannerService {

    public static readonly DEFAULT_TIMEOUT = 60;
    private timeout = PlannerAsyncService.DEFAULT_TIMEOUT; //this default is overridden by info from the configuration!
    private asyncMode = false;
    private planTimeScale = 1;
    private lastPlanPrinted = -1;

    constructor(plannerUrl: string, private asyncPlannerConfiguration: AsyncServiceConfiguration, providerConfiguration: planner.ProviderConfiguration) {
        super(plannerUrl, asyncPlannerConfiguration, providerConfiguration);
    }

    getTimeout(): number {
        return this.timeout;
    }

    createUrl(): string {
        return this.plannerPath + '?async=' + this.asyncMode;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async createRequestBody(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo): Promise<any> {
        const configuration = this.asyncPlannerConfiguration;
        if (!configuration) { return null; }

        configuration.planFormat = configuration.planFormat ?? 'JSON';
        if (configuration.timeout !== undefined) {
            this.timeout = configuration.timeout;
        }

        this.planTimeScale = PlannerAsyncService.toPlanTimeScale(configuration.planTimeUnit ?? DEFAULT_PLAN_TIME_UNIT_HOUR);

        let body = {
            'domain': {
                'name': domainFileInfo.name,
                'format': 'PDDL',
                'content': domainFileInfo.getText()
            },
            'problem': {
                'name': problemFileInfo.name,
                'format': 'PDDL',
                'content': problemFileInfo.getText()
            },
            'configuration': configuration
        };

        if (this.asyncPlannerConfiguration.searchDebuggerEnabled) {
            if (this.providerConfiguration.configuration.searchDebuggerSupport === planner.SearchDebuggerSupportType.HttpCallback) {
                if (!this.plannerPath.match(/http:\/\/(localhost|127\.0\.0\.1)[:\/]/)) {
                    throw new Error(`Search debugger HTTP Callback is only supported for servers running on localhost.`);
                }
                if (this.asyncPlannerConfiguration.searchDebuggerPort) {
                    body = Object.assign(body,
                        {
                            'callbacks': [
                                {
                                    'type': 'STATES',
                                    'url': 'http://localhost:' + this.asyncPlannerConfiguration.searchDebuggerPort,
                                }],
                        });
                } else {
                    throw new Error(`Search debugger port not provided.`);
                }
            }
        }

        return body;
    }

    static toPlanTimeScale(planTimeUnit: string): number {
        switch (planTimeUnit) {
            case "MINUTE":
                return 60;
            case "MILLISECOND":
                return 1 / 1000;
            case HOUR:
                return 60 * 60;
            case "DAY":
                return 24 * 60 * 60;
            case "WEEK":
                return 7 * 24 * 60 * 60;
            case "SECOND":
            default:
                return 1;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async processServerResponseBody(responseBody: any, planParser: parser.PddlPlannerOutputParser,
        callbacks: planner.PlannerResponseHandler,
        resolve: (plans: Plan[]) => void, reject: (error: Error) => void): Promise<void> {

        let _timedOut = false;
        const responseStatus: string = responseBody['status']['status'];
        if (["STOPPED", "SEARCHING_BETTER_PLAN"].includes(responseStatus)) {
            _timedOut = responseBody['status']['reason'] === "TIMEOUT";
            if (responseBody['plans'].length > 0) {
                const plansJson = responseBody['plans'];
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const parserPromises = plansJson.map((plan: any) => this.parsePlan(plan, planParser));
                    await Promise.all(parserPromises);
                }
                catch (err: unknown) {
                    reject(err as Error);
                }

                const plans = planParser.getPlans();
                for (let index = this.lastPlanPrinted+1; index < plans.length; index++) {
                    callbacks.handlePlan(plans[index]);
                    this.lastPlanPrinted = index;
                }
                if (plans.length === 0) {
                    callbacks.handleOutput('No plan found.');
                }

                resolve(plans);
                return;
            }
            else {
                // todo: no plan found yet. Poll again later.
                resolve([]);
                return;
            }
        }
        else if (responseStatus === "FAILED") {
            const error = responseBody['status']['error']['message'];
            reject(new Error(error));
            return;
        }
        else if (["NOT_INITIALIZED", "INITIATING", "SEARCHING_INITIAL_PLAN"].includes(responseStatus)) {
            _timedOut = true;
            const error = `After timeout ${this.timeout} the status is ${responseStatus}`;
            reject(new Error(error));
            return;
        }

        console.log(_timedOut);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async parsePlan(plan: any, planParser: parser.PddlPlannerOutputParser): Promise<void> {
        const makespan: number = plan['makespan'];
        const metric: number = plan['metricValue'];
        const searchPerformanceInfo = plan['searchPerformanceInfo'];
        const statesEvaluated: number = searchPerformanceInfo['statesEvaluated'];
        const elapsedTimeInSeconds = parseFloat(searchPerformanceInfo['timeElapsed']) / 1000;
        const planTimeUnit = plan['timeUnit'];
        planTimeUnit && console.log("Plan time unit: " + planTimeUnit);
        const planTimeScale = (planTimeUnit && PlannerAsyncService.toPlanTimeScale(planTimeUnit)) ?? this.planTimeScale;

        planParser.setPlanMetaData(makespan, metric, statesEvaluated, elapsedTimeInSeconds, planTimeScale);

        const planFormat: string | undefined = plan['format'];
        if (planFormat?.toLowerCase() === 'json') {
            const planSteps = JSON.parse(plan['content']);
            this.parsePlanSteps(planSteps, planParser);
            planParser.onPlanFinished();
        }
        else if (planFormat?.toLowerCase() === 'tasks') {
            const planText = plan['content'];
            planParser.appendLine(planText);
            planParser.onPlanFinished();
        }
        else if (planFormat?.toLowerCase() === 'xplan') {
            const planText = plan['content'];
            await planParser.appendXplan(planText); // must await the underlying async xml parsing
        }
        else {
            throw new Error('Unsupported plan format: ' + planFormat);
        }
    }

    static createDefaultConfiguration(timeout: number): AsyncServiceOnlyConfiguration {
        return {
            planFormat: "JSON",
            timeout: timeout
        };
    }
}

export interface AsyncServiceOnlyConfiguration {
    planFormat: string;
    planTimeUnit?: string;
    timeout?: number;
}

export interface AsyncServiceConfiguration extends planner.PlannerRunConfiguration, AsyncServiceOnlyConfiguration {
}