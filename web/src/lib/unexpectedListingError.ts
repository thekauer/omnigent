/** A listing or search answer that is not the shape the filesystem routes return. */
export class UnexpectedListingError extends Error {
  constructor() {
    super("the workspace returned an unexpected listing");
    this.name = "UnexpectedListingError";
  }
}
