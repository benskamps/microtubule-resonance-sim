# Contributing

Thank you for your interest in contributing to the Microtubule Resonance Simulator.

## How to Contribute

### Reporting Issues
- Open a GitHub issue describing the problem
- Include the browser and OS you're using
- If a computation produces unexpected results, note which engine and parameters

### Scientific Feedback
We especially welcome feedback from:
- **Experimentalists** with access to microtubule spectroscopy equipment
- **Biophysicists** who can assess our parameter choices and energy budget calculations
- **Computational physicists** who can identify errors in our numerical methods

Please open an issue tagged `scientific-review` with your assessment.

### Code Contributions
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Test in a browser (no build step required)
5. Submit a pull request

### Guidelines
- This is an exploratory project. Contributions should maintain intellectual honesty.
- If a computation produces results that challenge the current verdicts, that's valuable. Do not hide negative results.
- Keep the zero-dependency philosophy. No frameworks, no build tools.
- New engines should follow the existing pattern: pure functions, no DOM interaction, results stored in `PhysicsResults`.

## Code of Conduct

Be respectful, constructive, and honest. Extraordinary claims require extraordinary evidence. Computational models are tools for sharpening questions, not for proving predetermined conclusions.
