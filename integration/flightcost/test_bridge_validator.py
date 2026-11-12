import unittest
from bridge_validator import validate_design

class BridgeValidatorTest(unittest.TestCase):
    def setUp(self):
        self.design = {
            'protocol':'aircraft-designer/flightcost-design', 'version':1,
            'aircraft':{'icao':'T214','engine':'ПС-90А','seats':194,'cabin':[{'rows':33,'seatsPerRow':6,'lastRowSeats':2,'pitchM':0.79}]},
            'weights':{'oew_kg':61830,'mtow_kg':110750,'mlw_kg':93000,'mzfw_kg':84200,'fuel_capacity_kg':35710},
        }
    def test_good(self):
        self.assertEqual(validate_design(self.design,expected_icao='T214')['aircraft']['seats'],194)
    def test_bad_total(self):
        self.design['aircraft']['seats'] = 198
        with self.assertRaises(ValueError): validate_design(self.design)
    def test_bad_mass(self):
        self.design['weights']['oew_kg'] = float('nan')
        with self.assertRaises(ValueError): validate_design(self.design)
    def test_mismatch_engine(self):
        with self.assertRaises(ValueError): validate_design(self.design,expected_engine='PW2037')

if __name__ == '__main__': unittest.main()
