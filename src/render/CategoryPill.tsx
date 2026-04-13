import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import CategoryPillComponent, { CategoryPillState } from "../components/CategoryPillComponent";
import Config from "../config";
import { getPageLoaded } from "../content/state";
import { VoteResponse } from "../messageTypes";
import { Category, SegmentUUID, SponsorTime } from "../types";
import { waitFor } from "../utils/";
import { addCleanupListener } from "../utils/cleanup";
import { waitForElement } from "../utils/dom";
import { describeElement, logLifecycle } from "../utils/logger";

const id = "categoryPill";

export class CategoryPill {
    container: HTMLElement;
    ref: React.RefObject<CategoryPillComponent>;
    root: Root;

    lastState: CategoryPillState;

    mutationCount: number;
    isSegmentSet: boolean;
    mutationObserver?: MutationObserver;

    vote: (type: number, UUID: SegmentUUID, category?: Category) => Promise<VoteResponse>;

    constructor() {
        this.ref = React.createRef();
        this.mutationCount = 0;
        this.isSegmentSet = false;

        // this mutation observer listens to the change to title bar
        // bilibili will set the textContent of the title after loading for some reason.
        // If the node is inserted before this reset of title, it will be removed
        const mutationCounter = () => (this.mutationCount += 1);
        this.mutationObserver = new MutationObserver(mutationCounter.bind(this));

        addCleanupListener(() => {
            if (this.mutationObserver) {
                this.mutationObserver.disconnect();
            }
        });
    }

    async attachToPage(
        vote: (type: number, UUID: SegmentUUID, category?: Category) => Promise<VoteResponse>
    ): Promise<void> {
        this.vote = vote;
        this.mutationCount = 0;
        logLifecycle("categoryPill/attach:start", {
            hasContainer: Boolean(this.container),
            isSegmentSet: this.isSegmentSet,
            title: describeElement(getBilibiliTitleNode()),
        });

        const referenceNode = (await waitForElement(".video-info-container h1", true)) as HTMLElement;
        if (!referenceNode) {
            logLifecycle("categoryPill/attach:titleMissing", {
                title: describeElement(getBilibiliTitleNode()),
            });
            return;
        }
        logLifecycle("categoryPill/attach:titleReady", {
            title: describeElement(referenceNode),
            text: referenceNode.textContent?.trim() || null,
        });
        this.mutationObserver.disconnect();
        this.mutationObserver.observe(referenceNode, { attributes: true, childList: true });

        try {
            await waitFor(getPageLoaded, 10000, 10);
            // if setSegment is called after node attachment, it won't render sometimes
            await waitFor(() => this.isSegmentSet, 10000, 100).catch(() => {});
            this.attachToPageInternal();
        } catch (error) {
            if (error !== "TIMEOUT") {
                logLifecycle("categoryPill/attach:error", {
                    error: String(error),
                });
            }
        }
    }

    private async attachToPageInternal(): Promise<void> {
        const referenceNode = (await waitForElement(".video-info-container h1", true)) as HTMLElement;

        if (referenceNode && !referenceNode.contains(this.container)) {
            if (!this.container) {
                this.container = document.createElement("span");
                this.container.id = id;
                this.container.style.display = "relative";

                this.root = createRoot(this.container);
                this.ref = React.createRef();
                this.root.render(
                    <CategoryPillComponent
                        ref={this.ref}
                        vote={this.vote}
                        showTextByDefault={true}
                        showTooltipOnClick={false}
                    />
                );
            }

            if (this.lastState) {
                waitFor(() => this.ref.current).then(() => {
                    this.ref.current?.setState(this.lastState);
                });
            }

            referenceNode.prepend(this.container);
            referenceNode.style.display = "flex";
            logLifecycle("categoryPill/attach:mounted", {
                hasState: Boolean(this.lastState),
                title: describeElement(referenceNode),
                containerConnected: this.container?.isConnected ?? false,
            });
        }
    }

    close(): void {
        this.root.unmount();
        this.container.remove();
    }

    resetSegment(): void {
        const newState = {
            segment: null,
            show: false,
            open: false,
        };

        this.ref.current?.setState(newState);
        this.lastState = newState;
    }

    async setSegment(segment: SponsorTime): Promise<void> {
        logLifecycle("categoryPill/setSegment", {
            UUID: segment?.UUID,
            category: segment?.category,
            actionType: segment?.actionType,
            hasContainer: Boolean(this.container),
            containerConnected: this.container?.isConnected ?? false,
        });

        if (this.ref.current?.state?.segment !== segment) {
            const newState = {
                segment,
                show: true,
                open: false,
            };

            this.ref.current?.setState(newState);
            this.lastState = newState;

            if (!Config.config.categoryPillUpdate) {
                Config.config.categoryPillUpdate = true;
            }
        }

        if (this.container && !this.container.isConnected) {
            logLifecycle("categoryPill/setSegment:reattachNeeded", {
                UUID: segment?.UUID,
            });
            void this.attachToPageInternal();
        }
        this.isSegmentSet = true;
    }
}

function getBilibiliTitleNode(): HTMLElement {
    return document.querySelector(".video-info-container h1") as HTMLElement;
}
