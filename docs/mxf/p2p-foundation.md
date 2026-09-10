# P2P and federation status

MXF currently coordinates agents through a central server. This checkout does not
ship `P2PTaskNegotiationService`, `FederatedMemoryService`, a gossip discovery
service, or a cross-server peer transport. Earlier versions of this page described
those proposed services as existing components; those descriptions were incorrect.

The [task-negotiation demonstration](../../examples/p2p-task-negotiation-demo/)
asks an agent to assess supplied bids. It demonstrates reasoning about assignment
data. It does not exercise a distributed bidding protocol or server federation.

For current applications, use channel messaging and the server's acknowledged task
creation and assignment APIs. A future federation implementation would need explicit
peer authentication, authorization across servers, message delivery semantics, and
recovery tests before applications could depend on it.

See the [framework review](../reviews/2026-09-06-framework-review.md) for the broader
assessment and [task examples](../sdk/examples-tasks.md) for the implemented API.
