# Official solution: Encapsulamiento

## Expected intent

The implementation should protect object state and expose controlled operations.

## Reference implementation

Keep fields private or protected and validate changes through methods or
constructors.

## Acceptable variants

Equivalent designs are acceptable when they preserve invariants and keep the
public API coherent.

## Common mistakes

- Leaving mutable state public.
- Accepting invalid values.
- Adding setters that bypass validation.

## Notes for assisted evaluation

Compare the submitted code with the task statement, public acceptance criteria,
and the private rubric.
